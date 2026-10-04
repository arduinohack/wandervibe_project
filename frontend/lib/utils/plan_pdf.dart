import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

/// One itinerary row already ordered for the plan screen.
class PlanPdfRow {
  final String? dayHeader;
  final String type;
  final String start;
  final String duration;
  final String end;
  final String name;
  final String details;

  const PlanPdfRow({
    required this.dayHeader,
    required this.type,
    required this.start,
    required this.duration,
    required this.end,
    required this.name,
    required this.details,
  });
}

/// File name taken from the plan name, safe to share or download.
String planPdfFilename(String planName) {
  final cleaned = planName
      .trim()
      .replaceAll(RegExp(r'[\\/:*?"<>|]'), ' ')
      .trim();
  final base = cleaned.isEmpty ? 'plan' : cleaned;
  if (base.toLowerCase().endsWith('.pdf')) return base;
  return '$base.pdf';
}

/// PDF of the plan header and the rows in the order given.
Future<Uint8List> buildPlanPdf({
  required String name,
  required String destination,
  required String start,
  required String end,
  required List<PlanPdfRow> rows,
}) async {
  final document = pw.Document();
  document.addPage(
    pw.MultiPage(
      pageFormat: PdfPageFormat.a4,
      build: (context) {
        final blocks = <pw.Widget>[
          pw.Text(
            name,
            style: pw.TextStyle(fontSize: 22, fontWeight: pw.FontWeight.bold),
          ),
          pw.SizedBox(height: 8),
          pw.Text('Destination: $destination'),
          pw.Text('Start: $start'),
          pw.Text('End: $end'),
          pw.SizedBox(height: 16),
        ];
        for (final row in rows) {
          final header = row.dayHeader;
          if (header != null) {
            blocks
              ..add(pw.SizedBox(height: 12))
              ..add(
                pw.Text(
                  header,
                  style: pw.TextStyle(
                    fontSize: 16,
                    fontWeight: pw.FontWeight.bold,
                  ),
                ),
              )
              ..add(pw.SizedBox(height: 6));
          }
          blocks
            ..add(pw.Text('Type: ${row.type}'))
            ..add(pw.Text('Start: ${row.start}'))
            ..add(pw.Text('Duration: ${row.duration}'))
            ..add(pw.Text('End: ${row.end}'))
            ..add(
              pw.Text(
                row.name,
                style: pw.TextStyle(fontWeight: pw.FontWeight.bold),
              ),
            )
            ..add(pw.Text('Details: ${row.details}'))
            ..add(pw.SizedBox(height: 8));
        }
        return blocks;
      },
    ),
  );
  return document.save();
}
