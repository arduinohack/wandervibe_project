import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

/// One itinerary row already ordered for the plan screen.
class PlanPdfRow {
  final String? dayHeader;
  final String type;
  final String name;
  final String start;
  final String end;
  final String duration;
  final String location;
  final String details;
  final String googlePlaceId;
  final String bookingReference;
  final String cost;
  final String gate;
  final String baggageClaim;
  final String roomNumber;
  final String serviceProvider;
  final String status;
  final String customType;
  final String urlLinks;

  /// False opens [dayHeader] with no activity row.
  final bool includeRow;

  const PlanPdfRow({
    required this.dayHeader,
    required this.type,
    required this.name,
    required this.start,
    required this.end,
    required this.duration,
    required this.location,
    required this.details,
    required this.googlePlaceId,
    required this.bookingReference,
    required this.cost,
    required this.gate,
    required this.baggageClaim,
    required this.roomNumber,
    required this.serviceProvider,
    required this.status,
    required this.customType,
    required this.urlLinks,
    this.includeRow = true,
  });

  List<String> get cells => [
    type,
    name,
    start,
    end,
    duration,
    location,
    details,
    googlePlaceId,
    bookingReference,
    cost,
    gate,
    baggageClaim,
    roomNumber,
    serviceProvider,
    status,
    customType,
    urlLinks,
  ];
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

const _dayColumns = [
  'Type',
  'Name',
  'Start',
  'End',
  'Duration',
  'Location',
  'Details',
  'Google Place ID',
  'Booking reference',
  'Cost',
  'Gate',
  'Baggage claim',
  'Room number',
  'Service provider',
  'Status',
  'Custom type',
  'URL links',
];

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
        [for (final cell in row.cells) _tableCell(cell)],
    ],
    border: pw.TableBorder.all(width: 0.4),
    headerStyle: pw.TextStyle(fontWeight: pw.FontWeight.bold, fontSize: 10),
    cellStyle: pw.TextStyle(fontWeight: pw.FontWeight.normal, fontSize: 10),
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
  bool landscape = true,
}) async {
  final document = pw.Document();
  final days = _daysInOrder(rows);
  document.addPage(
    pw.MultiPage(
      pageFormat: landscape ? PdfPageFormat.a4.landscape : PdfPageFormat.a4,
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
