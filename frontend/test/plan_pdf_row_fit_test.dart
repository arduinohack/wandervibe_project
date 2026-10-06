import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:wandervibe_frontend/utils/plan_pdf.dart';

void main() {
  test('activity rows are 8-point, clocks stay tight, and cost and type fit', () async {
    final bytes = await buildPlanPdf(
      name: 'Fit Check',
      destination: 'Here',
      start: '10/05/26',
      end: '10/06/26',
      rows: const [
        PlanPdfRow(
          dayHeader: 'Day 1',
          type: 'Drive',
          name: 'Airport',
          start: '10/5 10:00 EDT',
          end: '10/5 11:00 EDT',
          duration: '60 min',
          location: 'Terminal',
          details:
              'A long details sentence that should take the extra column width.',
          bookingReference: '',
          cost: 'Cost(act):\n\$12.00',
          gate: '',
          baggageClaim: '',
          roomNumber: '',
          serviceProvider: '',
        ),
        PlanPdfRow(
          dayHeader: null,
          type: 'Car Service',
          name: 'Hotel',
          start: '10/5 12:00 EDT',
          end: '10/5 12:30 EDT',
          duration: '',
          location: '',
          details: 'More details after the clocks.',
          bookingReference: '',
          cost: '',
          gate: '',
          baggageClaim: '',
          roomNumber: '',
          serviceProvider: '',
        ),
        PlanPdfRow(
          dayHeader: null,
          type: 'Flight',
          name: 'Home',
          start: '10/5 15:00 EDT',
          end: '10/5 18:00 EDT',
          duration: '',
          location: '',
          details: '',
          bookingReference: '',
          cost: '',
          gate: '',
          baggageClaim: '',
          roomNumber: '',
          serviceProvider: '',
        ),
      ],
    );

    final page = _pdfPage(bytes);
    final literals = page.literals;
    expect(literals, contains('Drive'));
    expect(literals, contains('Flight'));
    expect(literals, contains('Service'));
    expect(literals, contains('Name'));
    expect(literals, contains('Car'));
    expect(literals, contains('Cost(act):'));
    expect(literals, contains(r'$12.00'));
    expect(literals.where((text) => text.startsWith('Cost(')), ['Cost(act):']);

    expect(page.fontSizeOf('Airport'), 8);
    expect(page.fontSizeOf('Start'), 10);
    expect(page.fontSizeOf('Details'), 10);

    expect(page.lineOf('Cost(act):'), isNot(page.lineOf(r'$12.00')));

    expect(page.columnWidthOf('Start'), lessThan(page.columnWidthOf('Details')));
    expect(page.columnWidthOf('End'), lessThan(page.columnWidthOf('Details')));
  });
}

class _PdfPage {
  _PdfPage(this.literals, this._fontSizes, this._lines, this._columnWidths);

  final List<String> literals;
  final Map<String, double> _fontSizes;
  final Map<String, double> _lines;
  final Map<String, double> _columnWidths;

  double fontSizeOf(String text) => _fontSizes[text]!;

  double lineOf(String text) => _lines[text]!;

  double columnWidthOf(String heading) => _columnWidths[heading]!;
}

_PdfPage _pdfPage(Uint8List bytes) {
  final source = latin1.decode(bytes, allowInvalid: true);
  final streams = RegExp(
    r'stream\r?\n([\s\S]*?)\r?\nendstream',
  ).allMatches(source);
  final buffer = StringBuffer();
  for (final match in streams) {
    final raw = latin1.encode(match.group(1)!);
    try {
      buffer.write(latin1.decode(zlib.decode(raw), allowInvalid: true));
    } catch (_) {}
  }
  final text = buffer.toString();
  final literals = <String>[];
  final fontSizes = <String, double>{};
  final lines = <String, double>{};
  final columnWidths = <String, double>{};
  var fontSize = 0.0;
  var columnWidth = 0.0;
  var textY = 0.0;
  final token = RegExp(
    r'([\d.]+) Tf|([\d.\-]+) ([\d.\-]+) ([\d.\-]+) ([\d.\-]+) re|([\d.\-]+) ([\d.\-]+) Td \[\((?:\\.|[^\\)])*\)\]TJ',
  );
  for (final match in token.allMatches(text)) {
    if (match.group(1) != null) {
      fontSize = double.parse(match.group(1)!);
      continue;
    }
    if (match.group(2) != null) {
      columnWidth = double.parse(match.group(4)!);
      continue;
    }
    textY = double.parse(match.group(7)!);
    final rawLiteral = RegExp(
      r'\(((?:\\.|[^\\)])*)\)',
    ).firstMatch(match.group(0)!)!.group(1)!;
    final literal = _pdfLiteral(rawLiteral);
    literals.add(literal);
    fontSizes.putIfAbsent(literal, () => fontSize);
    lines.putIfAbsent(literal, () => textY);
    if (columnWidth > 0) {
      columnWidths.putIfAbsent(literal, () => columnWidth);
    }
  }
  return _PdfPage(literals, fontSizes, lines, columnWidths);
}

String _pdfLiteral(String raw) {
  return raw.replaceAll(r'\(', '(').replaceAll(r'\)', ')');
}
