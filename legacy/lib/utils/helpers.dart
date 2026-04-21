import 'package:mobile_recommender/utils/logger.dart';

String getFirebaseImageUrl(String imageName) {
  if (imageName.isEmpty) {
    return ''; // Return an empty string if the image name is empty
  }
  final String encodedImageName = Uri.encodeComponent(imageName);
  final String url = 'https://firebasestorage.googleapis.com/v0/b/recsy-e2ae5.appspot.com/o/$encodedImageName?alt=media';
  logger.d('Generated URL: $url');
  return url;
}
