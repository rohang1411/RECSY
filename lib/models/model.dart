import 'package:flutter/material.dart';
import 'package:mobile_recommender/export.dart';

// class Mobile with ChangeNotifier {
//   final String id;
//   final String imageUrl;
//   final Color color;
//   final String name;
//   final Map<String, Object> specs;
//   bool isFav;

//   Mobile({
//     this.id,
//     this.imageUrl,
//     this.color,
//     this.name,
//     this.specs,
//     this.isFav,
//   });

//   void changeFav(String id) {
//     mobiles.forEach((element) {
//       if (element.id == id) {
//         element.isFav = !element.isFav;
//       }
//     });
//     notifyListeners();
//   }

//   Map<String, List> filterList = {
//     'Are You Fine With Chinese Smartphones?': ['Yes', 'No'],
//     'Budget': [
//       'Below ₹10k',
//       '₹10k-₹12k',
//       '₹12k-₹15k',
//       '₹15k-₹20k',
//       '₹20k-₹25k',
//       '₹25k-₹30k',
//       '₹30k-₹40k',
//       '₹40k-₹50k',
//       '₹50-₹70k',
//       '₹70k-₹100k',
//       '₹100k-₹120k',
//       'Above ₹120k'
//     ],
//     'First Priority Feature : ': ['Performance', 'Camera', 'Battery'],
//     'Second Priority Feature : ': ['Performance', 'Camera', 'Battery'],
//     'Display': ['Amazing', 'Great'],
//     'Charging': ['Fast', 'Super Fast'],
//   };
//   Map<String, List> filterListResult = {
//     'Are You Fine With Chinese Smartphones?': [],
//     'Budget': [],
//     'First Priority Feature : ': [],
//     'Second Priority Feature : ': [],
//     'Display': [],
//     'Charging': [],
//   };
//   List<Mobile> _compare = [];
//   List<Mobile> _recommend = [];
//   List<Mobile> get recommendations {
//     for (int i = 0; i < 75; i++) recommendations.add(mobiles[i]);
//     // mobiles.shuffle();
//     // if (_recommend.isNotEmpty) return [..._recommend];
//     // return [...mobiles.sublist(0, 5)];
//     return recommendations;
//   }

//   List<Mobile> get comparePhone {
//     for (var i in mobiles.sublist(0, 2)) {
//       _compare.add(i);
//     }
//     return [..._compare];
//   }

//   List<Mobile> get favorites {
//     return mobiles.where((element) => element.isFav).toList();
//   }

//   void randomCompare(int selected, Mobile mobile) {
//     _compare.removeAt(selected);
//     _compare.insert(selected, mobile);
//     notifyListeners();
//   }
// }

Map<String, dynamic> description = {
  'Ratings': Icons.star_rate_rounded,
  'Performance': Icons.analytics,
  'Cameras': Icons.camera,
  'Battery': Icons.battery_full_rounded,
};

List<String> routes = [
  LandingPage.LandingRoute,
  FilterPage.Route,
  UserProfile.Route,
];
