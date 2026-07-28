/**
 * Order Log — Netlify Function
 * Receives order from shop checkout, saves to Supabase, calls Apps Script for email/Telegram
 * 
 * Expects POST body:
 * {
 *   orderId, customerName, customerPhone, customerAddress, customerCity, customerPin,
 *   customerState, customerGstin, totalTaxableValue, totalGst, grandTotal, paymentId,
 *   items: [ { name, packSize, hsn, qty, unitPrice, taxableValue, gstAmount, gstRate, lineTotal } ]
 * }
 * 
 * Returns: { ok: true, invoiceNo: "ONAMonline/2026-27/0001", orderId: "WEB-..." }
 */

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'POST only' }) };
  }

  try {
    const data = JSON.parse(event.body);
    const orderId = data.orderId || ("WEB-" + Date.now());

    // Initialize Supabase
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Supabase not configured' })
      };
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check if order already exists (idempotency)
    const { data: existing, error: checkErr } = await supabase
      .from('orders')
      .select('id')
      .eq('order_id', orderId)
      .limit(1);

    if (checkErr) throw checkErr;

    if (existing && existing.length > 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: true,
          invoiceNo: existing[0].id,
          orderId: orderId,
          duplicate: true
        })
      };
    }

    // Generate invoice number (increment counter from kv table)
    const { data: kvData, error: kvErr } = await supabase
      .from('kv')
      .select('v')
      .eq('owner', 'orders')
      .eq('k', 'invoice_seq')
      .limit(1);

    if (kvErr) throw kvErr;

    let seq = 0;
    if (kvData && kvData.length > 0 && kvData[0].v) {
      seq = (kvData[0].v.seq || 0) + 1;
    } else {
      seq = 1;
    }

    // Update sequence
    await supabase
      .from('kv')
      .upsert({ owner: 'orders', k: 'invoice_seq', v: { seq: seq } }, { onConflict: 'owner,k' });

    const invoiceNo = 'ONAMonline/2026-27/' + String(seq).padStart(4, '0');

    // Normalize customer data
    const cust = {
      name: data.customerName || data.name || '',
      phone: data.customerPhone || data.phone || '',
      address: data.customerAddress || data.address || '',
      city: data.customerCity || data.city || '',
      pin: data.customerPin || data.pin || '',
      state: data.customerState || data.state || '',
      gstin: data.customerGstin || data.gstin || ''
    };

    const items = Array.isArray(data.items) ? data.items : [];
    const dateStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    // Parse amounts
    const taxable = parseFloat(data.totalTaxableValue || data.taxable || 0);
    const totalGst = parseFloat(data.totalGst || data.gst || 0);
    const grand = parseFloat(data.grandTotal || data.total || 0);

    // Determine tax type
    const isInterState = cust.state && String(cust.state).trim().toUpperCase() !== 'KARNATAKA';
    const cgst = isInterState ? 0 : Math.round(totalGst / 2 * 100) / 100;
    const sgst = isInterState ? 0 : Math.round(totalGst / 2 * 100) / 100;
    const igst = isInterState ? totalGst : 0;
    const taxType = isInterState ? 'IGST' : 'CGST+SGST';

    // Build items summary
    const itemsSummary = items.length
      ? items.map(i => (i.name || '?') + ' x' + (i.qty || 1)).join(' | ')
      : (data.description || '');

    // Save to orders table
    const { error: insertErr } = await supabase
      .from('orders')
      .insert([{
        id: invoiceNo,
        order_id: orderId,
        created_at: dateStr,
        payment_id: data.paymentId || '',
        customer_name: cust.name,
        customer_phone: cust.phone,
        customer_address: cust.address,
        customer_city: cust.city,
        customer_pin: cust.pin,
        customer_state: cust.state,
        customer_gstin: cust.gstin,
        taxable_value: taxable,
        cgst: cgst,
        sgst: sgst,
        igst: igst,
        total_gst: totalGst,
        grand_total: grand,
        tax_type: taxType,
        status: 'Pending',
        items_summary: itemsSummary,
        created_log_ts: new Date().toISOString()
      }]);

    if (insertErr) throw insertErr;

    // Save line items
    if (items.length) {
      const lineRows = items.map((item, idx) => {
        const gstAmt = parseFloat(item.gstAmount || 0);
        return {
          id: invoiceNo + '_line_' + (idx + 1),
          invoice_no: invoiceNo,
          order_id: orderId,
          created_at: dateStr,
          item_name: item.name || '',
          pack_size: item.packSize || '',
          hsn: item.hsn || '33074100',
          qty: parseFloat(item.qty || 0),
          unit_price: parseFloat(item.unitPrice || 0),
          taxable_value: parseFloat(item.taxableValue || 0),
          customer_state: cust.state,
          gst_rate: parseFloat(item.gstRate || 0),
          cgst: isInterState ? 0 : Math.round(gstAmt / 2 * 100) / 100,
          sgst: isInterState ? 0 : Math.round(gstAmt / 2 * 100) / 100,
          igst: isInterState ? gstAmt : 0,
          gst_amount: gstAmt,
          line_total: parseFloat(item.lineTotal || 0)
        };
      });

      const { error: lineErr } = await supabase
        .from('order_lines')
        .insert(lineRows);

      if (lineErr) throw lineErr;
    }

    // Call Apps Script for email + Telegram (non-blocking)
    const scriptUrl = process.env.ORDER_LOG_SCRIPT_URL;
    if (scriptUrl) {
      fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'newOrder',
          invoiceNo: invoiceNo,
          orderId: orderId,
          customerName: cust.name,
          customerPhone: cust.phone,
          customerAddress: cust.address,
          customerCity: cust.city,
          customerPin: cust.pin,
          customerState: cust.state,
          customerGstin: cust.gstin,
          totalTaxableValue: taxable,
          totalGst: totalGst,
          grandTotal: grand,
          paymentId: data.paymentId || '',
          items: items,
          date: dateStr
        })
      }).catch(err => console.log('Apps Script call failed:', err));
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        invoiceNo: invoiceNo,
        orderId: orderId
      })
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: false,
        error: String(error)
      })
    };
  }
};
