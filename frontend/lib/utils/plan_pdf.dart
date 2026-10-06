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
  final String bookingReference;
  final String cost;
  final String gate;
  final String baggageClaim;
  final String roomNumber;
  final String serviceProvider;

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
    required this.bookingReference,
    required this.cost,
    required this.gate,
    required this.baggageClaim,
    required this.roomNumber,
    required this.serviceProvider,
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

class _PdfColumn {
  final String heading;
  final String Function(PlanPdfRow row) value;

  const _PdfColumn(this.heading, this.value);
}

const _pdfColumns = [
  _PdfColumn('Type', _typeCell),
  _PdfColumn('Name', _nameCell),
  _PdfColumn('Start', _startCell),
  _PdfColumn('End', _endCell),
  _PdfColumn('Duration', _durationCell),
  _PdfColumn('Location', _locationCell),
  _PdfColumn('Details', _detailsCell),
  _PdfColumn('Booking reference', _bookingReferenceCell),
  _PdfColumn('Cost', _costCell),
  _PdfColumn('Gate', _gateCell),
  _PdfColumn('Baggage claim', _baggageClaimCell),
  _PdfColumn('Room number', _roomNumberCell),
  _PdfColumn('Service provider', _serviceProviderCell),
];

String _typeCell(PlanPdfRow row) => row.type;
String _nameCell(PlanPdfRow row) => row.name;
String _startCell(PlanPdfRow row) => row.start;
String _endCell(PlanPdfRow row) => row.end;
String _durationCell(PlanPdfRow row) => row.duration;
String _locationCell(PlanPdfRow row) => row.location;
String _detailsCell(PlanPdfRow row) => row.details;
String _bookingReferenceCell(PlanPdfRow row) => row.bookingReference;
String _costCell(PlanPdfRow row) => row.cost;
String _gateCell(PlanPdfRow row) => row.gate;
String _baggageClaimCell(PlanPdfRow row) => row.baggageClaim;
String _roomNumberCell(PlanPdfRow row) => row.roomNumber;
String _serviceProviderCell(PlanPdfRow row) => row.serviceProvider;

String _tableCell(String value) {
  if (value.trim() == 'not set') return '';
  return value;
}

bool _cellHasValue(String value) {
  final text = value.trim();
  return text.isNotEmpty && text != 'not set';
}

List<_PdfColumn> _columnsInPrint(List<PlanPdfRow> rows) {
  final activities = rows.where((row) => row.includeRow);
  return [
    for (final column in _pdfColumns)
      if (activities.any((row) => _cellHasValue(column.value(row)))) column,
  ];
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

const _bodyFontSize = 8.0;
const _headerFontSize = 10.0;

Map<int, pw.TableColumnWidth> _contentColumnWidths(List<_PdfColumn> columns) {
  return {
    for (var index = 0; index < columns.length; index++)
      index: columns[index].heading == 'Details'
          ? const pw.FlexColumnWidth()
          : const pw.IntrinsicColumnWidth(),
  };
}

/// One measurement of every activity. Each day table reuses these widths.
/// Activity columns stay as wide as their text. Details takes the leftover.
Map<int, pw.TableColumnWidth> _columnWidths(
  pw.Document document,
  List<PlanPdfRow> activities,
  List<_PdfColumn> columns,
  double maxWidth,
) {
  final measured = _dayTable(
    activities,
    columns,
    _contentColumnWidths(columns),
  );
  measured.layout(
    pw.Context(document: document.document).inheritFrom(pw.ThemeData.base()),
    pw.BoxConstraints(maxWidth: maxWidth),
  );
  final header = measured.children.first.children;
  return {
    for (var index = 0; index < columns.length; index++)
      index: columns[index].heading == 'Details'
          ? const pw.FlexColumnWidth()
          : pw.FixedColumnWidth(header[index].box!.width),
  };
}

String _twoDigits(int value) => value.toString().padLeft(2, '0');

/// Local clock of the device that builds the file: mm/dd/yy hh:nn, 24-hour.
String _generatedLabel(DateTime time) {
  final month = _twoDigits(time.month);
  final day = _twoDigits(time.day);
  final year = _twoDigits(time.year % 100);
  final hour = _twoDigits(time.hour);
  final minute = _twoDigits(time.minute);
  return 'Generated: $month/$day/$year $hour:$minute';
}

pw.Table _dayTable(
  List<PlanPdfRow> activities,
  List<_PdfColumn> columns,
  Map<int, pw.TableColumnWidth> columnWidths,
) {
  return pw.TableHelper.fromTextArray(
    headers: [for (final column in columns) column.heading],
    data: [
      for (final row in activities)
        [for (final column in columns) _tableCell(column.value(row))],
    ],
    border: pw.TableBorder.all(width: 0.4),
    headerStyle: pw.TextStyle(
      fontWeight: pw.FontWeight.bold,
      fontSize: _headerFontSize,
    ),
    cellStyle: pw.TextStyle(
      fontWeight: pw.FontWeight.normal,
      fontSize: _bodyFontSize,
    ),
    cellAlignment: pw.Alignment.topLeft,
    headerAlignment: pw.Alignment.topLeft,
    cellPadding: const pw.EdgeInsets.all(4),
    columnWidths: columnWidths,
    tableWidth: pw.TableWidth.min,
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
  final columns = _columnsInPrint(rows);
  final format = landscape ? PdfPageFormat.a4.landscape : PdfPageFormat.a4;
  final activities = [for (final row in rows) if (row.includeRow) row];
  final columnWidths = columns.isEmpty
      ? <int, pw.TableColumnWidth>{}
      : _columnWidths(document, activities, columns, format.availableWidth);
  final generated = _generatedLabel(DateTime.now());
  final chrome = const pw.TextStyle(fontSize: 9);
  document.addPage(
    pw.MultiPage(
      pageFormat: format,
      header: (context) {
        if (context.pageNumber <= 1) return pw.SizedBox.shrink();
        return pw.Padding(
          padding: const pw.EdgeInsets.only(bottom: 8),
          child: pw.Text(
            name,
            style: pw.TextStyle(fontSize: 12, fontWeight: pw.FontWeight.bold),
          ),
        );
      },
      footer: (context) {
        return pw.Padding(
          padding: const pw.EdgeInsets.only(top: 8),
          child: pw.Row(
            mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
            children: [
              pw.Text(generated, style: chrome),
              pw.Text(
                '${context.pageNumber} of ${context.pagesCount}',
                style: chrome,
              ),
            ],
          ),
        );
      },
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
          if (columns.isNotEmpty) {
            blocks.add(_dayTable(day.activities, columns, columnWidths));
          }
        }
        return blocks;
      },
    ),
  );
  return document.save();
}
