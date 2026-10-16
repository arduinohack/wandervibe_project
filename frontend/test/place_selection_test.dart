import 'package:flutter_test/flutter_test.dart';
import 'package:wandervibe_frontend/screens/plan_detail_screen.dart';

void main() {
  test('selecting a result sets the Place ID on the activity', () {
    final selection = applyPlaceSelection(
      location: '',
      placeId: '  ChIJISz8NjyuEmsRFTQ9Iw7Ear8  ',
      name: 'Cafe Paris',
    );

    expect(selection.googlePlaceId, 'ChIJISz8NjyuEmsRFTQ9Iw7Ear8');
    expect(selection.location, 'Cafe Paris');
  });

  test('a filled location keeps its name when a place is chosen', () {
    final selection = applyPlaceSelection(
      location: 'Harbor lunch',
      placeId: 'ChIJISz8NjyuEmsRFTQ9Iw7Ear8',
      name: 'Cafe Paris',
    );

    expect(selection.googlePlaceId, 'ChIJISz8NjyuEmsRFTQ9Iw7Ear8');
    expect(selection.location, isNull);
  });

  test('a blank place name does not clear an empty location', () {
    final selection = applyPlaceSelection(
      location: '   ',
      placeId: 'ChIJISz8NjyuEmsRFTQ9Iw7Ear8',
      name: '  ',
    );

    expect(selection.googlePlaceId, 'ChIJISz8NjyuEmsRFTQ9Iw7Ear8');
    expect(selection.location, isNull);
  });
}
