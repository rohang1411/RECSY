# RECSY - Mobile Recommender App

RECSY is a Flutter-based mobile application designed to help users find the best mobile phone based on their preferences. It provides personalized recommendations, detailed specifications, and a comparison feature to assist in making an informed decision.

## ✨ Features

- **Personalized Recommendations**: Get phone recommendations tailored to your needs.
- **Detailed Phone Specifications**: View in-depth details for each mobile phone, including display, processor, camera, and battery information.
- **Compare Phones**: Compare the specifications of multiple phones side-by-side.
- **Favorites**: Save your favorite phones for quick access later.
- **User Authentication**: Sign in to sync your favorites and preferences across devices.
- **Web & Mobile Support**: Built with Flutter, the app was initially built for android and the support for web platforms is in development.

## 🛠️ Tech Stack & Dependencies

- **Framework**: [Flutter](https://flutter.dev/)
- **Backend & Database**: [Firebase](https://firebase.google.com/)
  - **Authentication**: `firebase_auth`, `google_sign_in`
  - **Database**: `firebase_database`, `cloud_firestore`
  - **Storage**: Used for hosting phone images.
- **State Management**: [Provider](https://pub.dev/packages/provider)
- **UI Components**:
  - `carousel_slider`: For image carousels.
  - `dots_indicator`: To display progress for carousels.
  - `fluttertoast`: For simple user notifications.
- **Utilities**:
  - `url_launcher`: To open external links (e.g., 'Buy Now').
  - `http`, `html`, `xml`, `csv`: For data fetching and parsing.
  - `logger`: For application logging and debugging.

## 🚀 Getting Started

Follow these instructions to get a copy of the project up and running on your local machine for development and testing purposes.

### Prerequisites

- [Flutter SDK](https://flutter.dev/docs/get-started/install) (Version >= 3.0.0)
- A code editor like [VS Code](https://code.visualstudio.com/) or [Android Studio](https://developer.android.com/studio).
- A configured Firebase project.

### Installation

1.  **Clone the repository:**
    ```sh
    git clone https://github.com/your-username/mobile_recommender.git
    cd mobile_recommender
    ```

2.  **Set up Firebase:**
    - Place your `google-services.json` file in the `android/app/` directory.
    - Ensure your Firebase project has Authentication, Realtime Database, and Firestore enabled.

3.  **Install dependencies:**
    ```sh
    flutter pub get
    ```

4.  **Run the application:**
    ```sh
    flutter run
    ```
    To run on a specific device, like Chrome for web:
    ```sh
    flutter run -d chrome --web-renderer html
    ```

## 📂 Project Structure

The project follows a standard Flutter application structure:

```
lib/
├── data/         # Data sources and models
├── models/       # Core data models (e.g., Mobile)
├── screen/       # UI screens/pages of the app
├── services/     # Services for business logic (e.g., ML, recommendations)
├── utils/        # Utility functions and helpers
├── widget/       # Reusable UI widgets
└── main.dart     # Entry point of the application
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a pull request or open an issue to discuss any changes.

1.  Fork the Project
2.  Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3.  Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4.  Push to the Branch (`git push origin feature/AmazingFeature`)
5.  Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the `LICENSE` file for details.

