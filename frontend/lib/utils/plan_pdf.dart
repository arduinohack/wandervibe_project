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

  /// False opens [dayHeader] with no activity row.
  final bool includeRow;

  const PlanPdfRow({
    required this.dayHeader,
    required this.type,
    required this.start,
    required this.duration,
    required this.end,
    required this.name,
    required this.details,
    this.includeRow = true,
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

class _PdfDay {
  final String header;
  final List<PlanPdfRow> activities;

  _PdfDay(this.header, this.activities);
}

const _dayColumns = ['Type', 'Start', 'Duration', 'End', 'Name', 'Details'];

String _tableCell(String value) {
  if (value.trim() == 'not set') return '';
  return value;
}

List<_PdfDay> _daysInOrder(List<PlanPdfRow> rows) {
  final days = <_PdfDay>[];
  for (final row in rows) {
    final header = row.dayHeader;
    if (header != null) {
      days.add(_PdfDay(header, row.includeRow ? [row] : []));
    } else if (row.includeRow) {
      if (days.isEmpty) days.add(_PdfDay('', []));
      days.last.activities.add(row);
    }
  }
  return days;
}

pw.Widget _dayTable(List<PlanPdfRow> activities) {
  return pw.TableHelper.fromTextArray(
    headers: _dayColumns,
    data: [
      for (final row in activities)
        [
          _tableCell(row.type),
          _tableCell(row.start),
          _tableCell(row.duration),
          _tableCell(row.end),
          _tableCell(row.name),
          _tableCell(row.details),
        ],
    ],
    border: pw.TableBorder.all(width: 0.4),
    headerStyle: pw.TextStyle(fontWeight: pw.FontWeight.bold, fontSize: 10),
    cellStyle: const pw.TextStyle(fontSize: 10),
    cellAlignment: pw.Alignment.topLeft,
    headerAlignment: pw.Alignment.topLeft,
    cellPadding: const pw.EdgeInsets.all(4),
    defaultColumnWidth: const pw.FlexColumnWidth(),
  );
}

/// PDF of the plan header and one table for each day, in the order given.
/// A day header with no activity rows is still drawn, with an empty table.
Future<Uint8List> buildPlanPdf({
  required String name,
  required String destination,
  required String start,
  required String end,
  required List<PlanPdfRow> rows,
}) async {
  final document = pw.Document();
  final days = _daysInOrder(rows);
  document.addPage(
    pw.MultiPage(
      pageFormat: PdfPageFormat.a4,
      build: (context) {
        final blocks = <pw.Widget>[
          pw.Text(
            name,
            style: pw.TextStyle(fontSize: 18, fontWeight: pw.FontWeight.bold),
          ),
          pw.SizedBox(height: 8),
          pw.Text(
            'Destination: $destination',
            style: const pw.TextStyle(fontSize: 10),
          ),
          pw.Text('Start: $start', style: const pw.TextStyle(fontSize: 10)),
          pw.Text('End: $end', style: const pw.TextStyle(fontSize: 10)),
          pw.SizedBox(height: 16),
        ];
        for (final day in days) {
          if (day.header.isNotEmpty) {
            blocks
              ..add(pw.SizedBox(height: 12))
              ..add(
                pw.Text(
                  day.header,
                  style: pw.TextStyle(
                    fontSize: 14,
                    fontWeight: pw.FontWeight.bold,
                  ),
                ),
              )
              ..add(pw.SizedBox(height: 6));
          }
          blocks.add(_dayTable(day.activities));
        }
        return blocks;
      },
    ),
  );
  return document.save();
}
