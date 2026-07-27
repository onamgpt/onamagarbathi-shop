/**
 * Packing Slip PDF Generator
 * Called from Apps Script after order is saved
 * Generates a PDF packing slip for parcels
 * 
 * Usage: POST /.netlify/functions/packing-slip-pdf
 * Body: { invoiceNo, orderId, items, cust, grand, dateStr }
 * Returns: { pdf: "base64_encoded_pdf" }
 */

const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'POST only' }) };
  }

  try {
    const data = JSON.parse(event.body);
    const { invoiceNo, orderId, items, cust, grand, dateStr } = data;

    if (!invoiceNo || !cust || !cust.name) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields: invoiceNo, cust.name' })
      };
    }

    // Generate QR code
    let qrDataUrl = '';
    try {
      qrDataUrl = await QRCode.toDataURL(invoiceNo);
    } catch (qrErr) {
      console.log('QR generation failed, continuing without QR');
    }

    // Create PDF
    const doc = new PDFDocument({
      size: 'A4',
      margin: 15,
      bufferPages: true
    });

    let pdfBuffer = Buffer.alloc(0);
    doc.on('data', (chunk) => {
      pdfBuffer = Buffer.concat([pdfBuffer, chunk]);
    });

    return new Promise((resolve) => {
      doc.on('end', () => {
        const base64Pdf = pdfBuffer.toString('base64');
        resolve({
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          },
          body: JSON.stringify({ ok: true, pdf: base64Pdf, invoiceNo: invoiceNo })
        });
      });

      // --- PDF CONTENT ---

      // Header with branding
      doc.fontSize(20).font('Helvetica-Bold').text('ONAM AGARBATHI', { align: 'center' });
      doc.fontSize(9).font('Helvetica').text('Bengaluru | Since 1972 | GST: 29AAACO2213Q1Z8', { align: 'center' });
      doc.moveDown(0.3);
      doc.moveTo(15, doc.y).lineTo(580, doc.y).stroke('#c41e3a');
      doc.moveDown(0.5);

      // Title
      doc.fontSize(14).font('Helvetica-Bold').text('PACKING SLIP', { align: 'center' });
      doc.moveDown(0.3);

      // Invoice info in two columns
      const col1X = 15, col2X = 300;
      const infoY = doc.y;

      // Left: Invoice details
      doc.fontSize(9).font('Helvetica-Bold').text('Invoice No:', col1X, infoY);
      doc.fontSize(11).font('Helvetica-Bold').text(invoiceNo, col1X, doc.y);
      doc.fontSize(8).font('Helvetica').text('Order ID: ' + (orderId || 'N/A'), col1X, doc.y);
      doc.fontSize(8).text('Date: ' + (dateStr || ''), col1X, doc.y);

      // Right: QR code
      if (qrDataUrl) {
        try {
          const qrBuffer = Buffer.from(qrDataUrl.split(',')[1], 'base64');
          doc.image(qrBuffer, 480, infoY, { width: 85, height: 85 });
        } catch (imgErr) {
          console.log('Could not embed QR image');
        }
      }

      doc.y = Math.max(doc.y, infoY + 100);
      doc.moveDown(0.5);
      doc.moveTo(15, doc.y).lineTo(580, doc.y).stroke();
      doc.moveDown(0.5);

      // Delivery address - LARGE AND PROMINENT
      doc.fontSize(10).font('Helvetica-Bold').text('DELIVER TO:', 15);
      doc.fontSize(16).font('Helvetica-Bold').text((cust.name || 'CUSTOMER').toUpperCase(), 15);
      doc.fontSize(10).font('Helvetica').text(cust.phone || '', 15);
      doc.fontSize(10).text(cust.address || '', 15, doc.y, { width: 500 });
      doc.moveDown(0.3);
      doc.fontSize(10).text([cust.city, cust.pin].filter(String).join(', '), 15);
      doc.fontSize(10).text((cust.state || '').toUpperCase(), 15);
      if (cust.gstin) {
        doc.fontSize(8).font('Helvetica-Bold').text('GSTIN: ' + cust.gstin, 15);
      }

      doc.moveDown(0.5);
      doc.moveTo(15, doc.y).lineTo(580, doc.y).stroke();
      doc.moveDown(0.5);

      // Items
      doc.fontSize(10).font('Helvetica-Bold').text('ITEMS IN THIS PARCEL:', 15);
      doc.moveDown(0.2);

      if (items && items.length) {
        items.forEach((item, idx) => {
          const qty = item.qty || 1;
          const name = (item.name || 'Item') + (item.packSize ? ' (' + item.packSize + ')' : '');
          doc.fontSize(9).font('Helvetica').text((idx + 1) + '.  ' + name + '  x  ' + qty, 25);
        });
      } else {
        doc.fontSize(9).text('See order details online', 25);
      }

      doc.moveDown(0.5);
      doc.moveTo(15, doc.y).lineTo(580, doc.y).stroke();
      doc.moveDown(0.5);

      // Amount box
      doc.rect(15, doc.y, 550, 50).stroke();
      doc.fontSize(11).font('Helvetica').text('TOTAL AMOUNT:', 25, doc.y + 10);
      doc.fontSize(16).font('Helvetica-Bold').text('Rs. ' + (grand || '0'), 25, doc.y + 5, { align: 'right', width: 530 });
      doc.moveDown(3.5);

      // Footer
      doc.fontSize(7).font('Helvetica').text('Generated: ' + new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }), 15, doc.y);
      doc.fontSize(7).text('Status: Pending Dispatch | Print and attach to parcel', 15, doc.y);

      doc.end();
    });

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: String(error) })
    };
  }
};
