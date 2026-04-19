import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_database/firebase_database.dart';
import 'package:flutter/material.dart';
import 'package:mobile_recommender/data/data.dart';
import 'package:mobile_recommender/models/model.dart';
import '../utils/logger.dart';

class FilterPage with ChangeNotifier {
  final FirebaseAuth _auth = FirebaseAuth.instance;
  final DatabaseReference dbRef =
      FirebaseDatabase.instance.ref().child("users");

  List<String>? fav;
  List<String>? favlist;
  List<Mobile> bannerList = [];
  List<Mobile> filterListResult = [];
  List<Mobile> recommendations = [];
  List<Mobile> comparePhone = [];
  List<Mobile> get favorites {
    return mobiles.where((element) => element.isFav).toList();
  }
  List<Mobile> banners = [];

  FilterPage() {
    if (mobiles.isNotEmpty) {
      banners = mobiles.sublist(0, 5);
    }
  }

  void changeFav(String id) {
    final mobile = findById(id);
    mobile.isFav = !mobile.isFav;
    notifyListeners();
    }

  var showName = '';

  int strToint(String temp) {
    if (temp.isEmpty) return 0;
    switch (temp[0]) {
      case '0':
        return 0;
      case '1':
        return 1;
      case '2':
        return 2;
      case '3':
        return 3;
      case '4':
        return 4;
      case '5':
        return 5;
      case '6':
        return 6;
      case '7':
        return 7;
      case '8':
        return 8;
      case '9':
        return 9;
      default:
        return 0;
    }
  }

  Map<dynamic, dynamic>? userDataMap;

  Future<void> getData() async {
    final User? user = _auth.currentUser;
    if (user == null) return;
    final uid = user.uid;
    try {
      final DataSnapshot snapshot = await dbRef.child(uid).get();
      userDataMap = snapshot.value as Map<dynamic, dynamic>?;
      if (userDataMap == null) return;
      showName = userDataMap!['Name'];
      final favourites = userDataMap!['Favourites'];
      if (favourites != null) {
        List<String> favIDList = [];
        for (int i = 0; i < favourites.length; i++) {
          if (favourites[i] != null) {
            favIDList.add(favourites[i]);
          }
        }
        fav = favIDList;
        favlist = favIDList;
        notifyListeners();
      }
    } catch (e, s) {
      logger.e('Error in getData', e, s);
    }
  }

  void toggleFavorite(String mobileId) {
    final User? user = _auth.currentUser;
    final uid = user!.uid;
    if (fav!.contains(mobileId)) {
      fav!.remove(mobileId);
      dbRef.child(uid).child('Favourites').set(fav);
    } else {
      fav!.add(mobileId);
      dbRef.child(uid).child('Favourites').set(fav);
    }
    notifyListeners();
  }

  List<Mobile> get mobile {
    return [...bannerList];
  }

  Mobile findById(String id) {
    // Search the global mobiles list to prevent crashes.
    return mobiles.firstWhere((mob) => mob.id == id);
  }

  void randomCompare(int selected, Mobile mobile) {
    try {
      logger.i('randomCompare called. Selected index: $selected, Phone: ${mobile.name}');
      logger.d('comparePhone state before: ${comparePhone.map((p) => p.name).toList()}');

      // Ensure the list has placeholders up to the selected index.
      while (comparePhone.length <= selected) {
        // This is a temporary, empty mobile object to act as a placeholder.
        comparePhone.add(Mobile(id: '', name: 'Select Phone', imageUrl: '', specs: {}, color: Colors.grey, buyLink: ''));
      }

      // Replace the placeholder or existing phone at the selected index.
      comparePhone[selected] = mobile;

      logger.d('comparePhone state after: ${comparePhone.map((p) => p.name).toList()}');
      notifyListeners();
    } catch (e, s) {
      logger.e('Error in randomCompare', e, s);
    }
  }
}
