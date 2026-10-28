import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wandervibe_frontend/models/activity_attachment.dart';
import 'package:wandervibe_frontend/utils/activity_attachment.dart';
import 'package:wandervibe_frontend/utils/attachment_picker.dart';
import 'package:wandervibe_frontend/widgets/activity_attachments.dart';

const _png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

ActivityAttachment _file({
  required String id,
  required String filename,
  required String uploadedBy,
  String mimeType = 'image/png',
  int size = 1536,
}) {
  return ActivityAttachment(
    id: id,
    activityId: 'act-1',
    planId: 'plan-1',
    uploadedBy: uploadedBy,
    filename: filename,
    mimeType: mimeType,
    size: size,
  );
}

Future<void> _pump(
  WidgetTester tester, {
  required String? role,
  required String? userId,
  required List<ActivityAttachment> items,
  Future<ActivityAttachmentWriteResult> Function(
    String filename,
    Uint8List bytes,
  )?
  upload,
  Future<ActivityAttachmentFileResult> Function(String attachmentId)? fetch,
  Future<ActivityAttachmentWriteResult> Function(String attachmentId)? remove,
  Future<AttachmentPickResult> Function()? pick,
  ActivityAttachmentListResult? loadResult,
}) async {
  var current = List<ActivityAttachment>.of(items);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: ActivityAttachmentsPanel(
          storedRole: role,
          userId: userId,
          loadAttachments: () async {
            return loadResult ??
                ActivityAttachmentListResult(status: 200, attachments: current);
          },
          uploadAttachment: (filename, bytes) async {
            if (upload != null) return upload(filename, bytes);
            current = [
              ...current,
              _file(id: 'new', filename: filename, uploadedBy: userId ?? ''),
            ];
            return const ActivityAttachmentWriteResult(status: 201);
          },
          fetchFile:
              fetch ??
              (id) async => ActivityAttachmentFileResult(
                status: 200,
                bytes: Uint8List.fromList(base64Decode(_png)),
                mimeType: 'image/png',
              ),
          deleteAttachment: (id) async {
            if (remove != null) return remove(id);
            current = [
              for (final item in current)
                if (item.id != id) item,
            ];
            return const ActivityAttachmentWriteResult(status: 200);
          },
          pickFile:
              pick ??
              () async => AttachmentPickResult.file(
                PickedAttachmentFile(
                  filename: 'note.pdf',
                  bytes: Uint8List.fromList(const [37, 80, 68, 70]),
                ),
              ),
        ),
      ),
    ),
  );
  await tester.pump();
  await tester.pump();
}

void main() {
  testWidgets('a guest sees the file and View, and no Add or Delete', (
    tester,
  ) async {
    await _pump(
      tester,
      role: 'Guest',
      userId: 'gus',
      items: [
        _file(
          id: '1',
          filename: 'photo.jpg',
          uploadedBy: 'ada',
          mimeType: 'image/jpeg',
        ),
      ],
    );

    expect(find.text('Attachments'), findsOneWidget);
    expect(find.text('photo.jpg'), findsOneWidget);
    expect(find.text('1.5 KB'), findsOneWidget);
    expect(find.text('View'), findsOneWidget);
    expect(find.text('Add attachment'), findsNothing);
    expect(find.byTooltip('Delete attachment'), findsNothing);

    await tester.tap(find.text('View'));
    await tester.pump();
    await tester.pump();
    expect(find.byType(Image), findsOneWidget);
  });

  testWidgets('an owner can add a file and it shows up in the list', (
    tester,
  ) async {
    await _pump(
      tester,
      role: 'Owner',
      userId: 'ada',
      items: [_file(id: '1', filename: 'photo.jpg', uploadedBy: 'ada')],
    );

    expect(find.text('Add attachment'), findsOneWidget);
    expect(find.byTooltip('Delete attachment'), findsOneWidget);

    await tester.tap(find.text('Add attachment'));
    await tester.pump();
    await tester.pump();

    expect(find.text('note.pdf'), findsOneWidget);
    expect(find.text('photo.jpg'), findsOneWidget);
  });

  testWidgets('a collaborator can delete only a file they uploaded', (
    tester,
  ) async {
    String? deleted;
    await _pump(
      tester,
      role: 'Collaborator',
      userId: 'ada',
      items: [
        _file(id: 'mine', filename: 'mine.png', uploadedBy: 'ada'),
        _file(id: 'theirs', filename: 'theirs.png', uploadedBy: 'gus'),
      ],
      remove: (id) async {
        deleted = id;
        return const ActivityAttachmentWriteResult(status: 200);
      },
    );

    expect(find.byTooltip('Delete attachment'), findsOneWidget);

    await tester.tap(find.byTooltip('Delete attachment'));
    await tester.pump();
    await tester.pump();
    await tester.tap(find.widgetWithText(TextButton, 'Delete'));
    await tester.pump();
    await tester.pump();

    expect(deleted, 'mine');
  });

  testWidgets('a type error from the API shows in a snackbar', (tester) async {
    await _pump(
      tester,
      role: 'Collaborator',
      userId: 'ada',
      items: const [],
      upload: (filename, bytes) async {
        return const ActivityAttachmentWriteResult(
          status: 400,
          error: 'Only images and PDF files can be attached',
        );
      },
    );

    expect(find.text('No files yet.'), findsOneWidget);
    await tester.tap(find.text('Add attachment'));
    await tester.pump();
    await tester.pump();

    expect(
      find.text('Only images and PDF files can be attached'),
      findsOneWidget,
    );
    expect(find.text('No files yet.'), findsOneWidget);
  });

  testWidgets('a file over 10 MB is rejected before upload', (tester) async {
    var uploads = 0;
    await _pump(
      tester,
      role: 'Owner',
      userId: 'ada',
      items: const [],
      pick: () async => AttachmentPickResult.file(
        PickedAttachmentFile(
          filename: 'huge.jpg',
          bytes: Uint8List(attachmentMaxBytes + 1),
        ),
      ),
      upload: (filename, bytes) async {
        uploads += 1;
        return const ActivityAttachmentWriteResult(status: 201);
      },
    );

    await tester.tap(find.text('Add attachment'));
    await tester.pump();
    await tester.pump();

    expect(uploads, 0);
    expect(find.text(attachmentSizeMessage), findsOneWidget);
  });

  testWidgets('a network failure shows the server message', (tester) async {
    await _pump(
      tester,
      role: 'Guest',
      userId: 'gus',
      items: const [],
      loadResult: const ActivityAttachmentListResult(),
    );

    expect(find.text(attachmentNetworkMessage), findsWidgets);
  });
}
