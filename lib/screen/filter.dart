// import 'dart:html';
import 'package:http/http.dart' as http;
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_database/firebase_database.dart';
import 'package:flutter/material.dart';
// import 'package:html/parser.dart';
// import 'package:http/http.dart';
import 'package:mobile_recommender/export.dart';
import 'package:shared_preferences/shared_preferences.dart';
// import 'package:xml/xml.dart';

import 'dart:io';
import 'dart:convert';
import 'dart:async';
import 'package:tflite/tflite.dart';
import 'package:flutter/services.dart';
import 'package:tflite_flutter/tflite_flutter.dart';
import 'dart:math';
import 'package:csv/csv.dart';
import 'package:splashscreen/splashscreen.dart';
import 'package:carousel_slider/carousel_controller.dart';
import 'package:carousel_slider/carousel_options.dart';
import 'package:carousel_slider/carousel_slider.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:sortedmap/sortedmap.dart';

import 'package:http/http.dart' as http;
import 'package:html/parser.dart' as parser;
import 'package:html/dom.dart' as dom;
import 'package:url_launcher/url_launcher.dart';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

import 'dart:math';

String model_selection = 'modelwc6.tflite';
List<List<dynamic>> csvTable = [[]];
List<List<dynamic>> imageLinksCSV = [[]];
List<List<dynamic>> data = [[]];
int maxIndex = 0;
double flagChinese = 0;
List<FilterPage> _recommend = [];
List<FilterPage> bannerList = [];
List<List<double>> input = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
];
loadAsset() async {
  print('Hi AU');
  // print("load asset");
  final myData = await rootBundle.loadString("assets/Final Model Dataset.csv");
  csvTable = CsvToListConverter().convert(myData);
  data = csvTable;
  final imageLinks = await rootBundle.loadString("assets/Image Links.csv");
  imageLinksCSV = CsvToListConverter().convert(imageLinks);

  // print('csvTable = ');
  // print(csvTable);
  // print('imageLinksCSV = ');
  // print(imageLinksCSV);
}
// class SendRecommendations with ChangeNotifier {
//   List<Mobile> get rec {
//     return [..._recommend];
//   }
// }

class FilterPage extends StatefulWidget with ChangeNotifier {
  final String id;
  final String imageUrl;
  final String buyLink;
  final Color color;
  final String name;
  final Map<String, Object> specs;
  bool isFav;

  final FirebaseAuth _auth = FirebaseAuth.instance;
  final DatabaseReference dbRef =
      FirebaseDatabase.instance.reference().child("users");

  List<String> fav;
  List<String> favlist;

  var showName = '';

  int strToint(String temp) {
    switch (temp[0]) {
      case '0':
        return 0;
        break;

      case '1':
        return 1;
        break;

      case '2':
        return 2;
        break;

      case '3':
        return 3;
        break;

      case '4':
        return 4;
        break;

      case '5':
        return 5;
        break;

      case '6':
        return 6;
        break;

      case '7':
        return 7;
        break;

      case '8':
        return 8;
        break;

      case '9':
        return 9;
        break;
    }
  }

  Map<dynamic, dynamic> userDataMap;

  Future<void> getData() async {
    final User user = await _auth.currentUser;
    final uid = user.uid;
    dbRef.child(uid).once().then((DataSnapshot snapshot) async {
      // print('Data : ${snapshot.value}');
      userDataMap = snapshot.value;
      // print(snapshot.value);
      showName = userDataMap['Name'];
      // print(showName);
      List<String> favIDList = [];

      // print(userDataMap['Favourites']);

      for (int i = 0; i < userDataMap['Favourites'].length; i++) {
        // print(userDataMap['Favourites'][i].toString());
        favIDList.add(userDataMap['Favourites'][i].toString());
        if (favIDList[i].length == 1)
          mobiles[strToint(favIDList[i])].isFav = true;
        else if (favIDList[i].length == 2)
          mobiles[strToint(favIDList[i][0]) * 10 + strToint(favIDList[i][1])]
              .isFav = true;
      }
      // favIDList = userDataMap['Favourites'];
      // print(favIDList);
      // print('HELLO UPDATED THE FAVOURITES IN MOBILES');
    });
  }

  @override
  void initState() {
    getData();
  }

  // List<FilterPage> bannerList = ;
  List<FilterPage> get banners {
    // mobiles.shuffle();
    // print(bannerList[0].name);
    if (bannerList.isNotEmpty) return [...bannerList];
    return [...mobiles.sublist(0, 5)];
  }

  // List<FilterPage> _recommend = [];
  List<FilterPage> get rec {
    return _recommend;
  }

  String get nameGetter {
    // print(showName);
    return showName;
  }

  FilterPage({
    this.id,
    this.imageUrl,
    this.buyLink,
    this.color,
    this.name,
    this.specs,
    this.isFav,
  });
  void changeFav(String id) {
    mobiles.forEach((element) {
      if (element.id == id) {
        element.isFav = !element.isFav;
      }
    });
    notifyListeners();
  }

  Map<String, List> filterList = {
    'Are You Fine With Chinese Smartphones?': ['Yes', 'No'],
    'Budget': [
      'Below ₹10k',
      '₹10k-₹12k',
      '₹12k-₹15k',
      '₹15k-₹20k',
      '₹20k-₹25k',
      '₹25k-₹30k',
      '₹30k-₹40k',
      '₹40k-₹50k',
      '₹50-₹70k',
      '₹70k-₹100k',
      '₹100k-₹120k',
      'Above ₹120k'
    ],
    'First Priority Feature : ': ['Performance', 'Camera', 'Battery'],
    'Second Priority Feature : ': ['Performance', 'Camera', 'Battery'],
    'Display': ['Amazing', 'Great'],
    'Charging': ['Fast', 'Super Fast'],
  };
  Map<String, List> filterListResult = {
    'Are You Fine With Chinese Smartphones?': [],
    'Budget': [],
    'First Priority Feature : ': [],
    'Second Priority Feature : ': [],
    'Display': [],
    'Charging': [],
  };
  List<FilterPage> _compare = [];
  // List<FilterPage> _recommend = [];
  // List<Mobile> get recommendations {
  //   for (int i = 0; i < 75; i++) recommendations.add(mobiles[i]);
  //   // mobiles.shuffle();
  //   // if (_recommend.isNotEmpty) return [..._recommend];
  //   // return [...mobiles.sublist(0, 5)];
  //   return recommendations;
  // }

  List<FilterPage> get comparePhone {
    for (var i in mobiles.sublist(0, 2)) {
      _compare.add(i);
    }
    return [..._compare];
  }

  List<FilterPage> get favorites {
    // print('HELLO LOADED THE USER PAGE FAVOURITES');
    return mobiles.where((element) => element.isFav).toList();
  }

  void randomCompare(int selected, FilterPage mobile) {
    _compare.removeAt(selected);
    _compare.insert(selected, mobile);
    notifyListeners();
  }

  static const Route = '/filter';

  @override
  _FilterPageState createState() => _FilterPageState();
}

class _FilterPageState extends State<FilterPage> {
  List<String> title = List();
  List<String> post = List();
  List<String> link = List();
  var temp;
  var tempSnap;
  var tempExynos;
  var tempMediatek;
  var tempApple;

  //WEB SCRAPING FUNCTION FOR MOBILE SPECS
  // void _getData() async {
  //   print(mobiles.length);
  //   for (int i = 1; i < 76; i++) {
  //     String gsmLink = csvTable[i][22];
  //     // PUT LOOP HERE FOR ALL LINKS
  //     var client = Client();
  //     Response response = await client.get(gsmLink);

  //     // Use html parser
  //     var document = parse(response.body);
  //     List<dom.Element> links = document.getElementsByTagName('td.nfo');
  //     // print(links[1].attributes['data-spec']);
  //     List<Map<String, dynamic>> linkMap = [];
  //     String fcam;
  //     String rcam;
  //     String display;
  //     String processor;
  //     String battery;
  //     String storage;
  //     String resolution;

  //     for (var link in links) {
  //       // linkMap.add({
  //       //   // 'title': link.text,
  //       //   // 'href': link.attributes['href'],
  //       //   'title': link.attributes['data-spec']
  //       // });
  //       if (link.attributes['data-spec'] == 'cam1modules') {
  //         // print("rear camera = " + link.text);
  //         rcam = link.text;
  //       }
  //       if (link.attributes['data-spec'] == 'cam2modules') {
  //         // print("front camera = " + link.text);
  //         fcam = link.text;
  //       }
  //       if (link.attributes['data-spec'] == 'chipset') {
  //         // print("processor = " + link.text);
  //         processor = link.text;
  //       }
  //       if (link.attributes['data-spec'] == 'internalmemory') {
  //         // print("Storage = " + link.text);
  //         storage = link.text;
  //       }
  //       if (link.attributes['data-spec'] == 'displayresolution') {
  //         // print("resolution = " + link.text);
  //         resolution = link.text;
  //       }
  //       if (link.attributes['data-spec'] == 'displaytype') {
  //         // print("display = " + link.text);
  //         display = link.text;
  //       }
  //       if (link.attributes['data-spec'] == 'batdescription1') {
  //         // print(link.text);
  //         battery = link.text;
  //       }
  //     }
  //     //Snapdragon
  //     if (new RegExp(r'Snapdragon') != null)
  //       tempSnap = processor.indexOf(new RegExp(r'Snapdragon'));
  //     else if (new RegExp(r'Exynos') != null)
  //       tempExynos = processor.indexOf(new RegExp(r'Exynos'));
  //     else if (new RegExp(r'MediaTek') != null)
  //       tempMediatek = processor.indexOf(new RegExp(r'MediaTek'));
  //     else if (new RegExp(r'Apple') != null)
  //       tempApple = processor.indexOf(new RegExp(r'Apple'));

  //     if (tempSnap != -1)
  //       temp = 'SD ' + processor.substring(tempSnap + 11, tempSnap + 15);
  //     //Exynos
  //     else if (tempExynos != -1)
  //       temp = 'Exynos ' + processor.substring(tempSnap + 7, tempSnap + 11);
  //     //Mediatek
  //     else if (tempMediatek != -1)
  //       temp = 'MT ' + processor.substring(tempSnap + 15, tempSnap + 19);
  //     //Apple
  //     else if (tempApple != -1)
  //       temp = 'Apple ' + processor.substring(tempSnap + 6, tempSnap + 9);

  //     mobiles.add(Mobile(
  //         id: i.toString(),
  //         isFav: false,
  //         imageUrl: 'https://drive.google.com/uc?export=view&id=' +
  //             imageLinksCSV[i][1].toString(),
  //         color: Color(0xffF1ECF3),
  //         name: csvTable[i][0],
  //         specs: {
  //           'Cameras': '\n' + rcam.substring(0, 5),
  //           'Front Camera': '\n' + fcam,
  //           'Rear Camera': '\n' + rcam,
  //           'Display': '\n' + display,
  //           'Processor': '\n' + processor,
  //           'performance': '\n' + temp,
  //           'Ratings': '\n' + (csvTable[i][21] * 6).toString(),
  //           'Storage': '\n' + storage,
  //           'Battery': '\n' + battery,
  //           'Resolution': '\n' + resolution,
  //         }));
  //     print(mobiles[i + 8]);
  //   }
  // }

  // Classifier _classifier;
  // Classifierncp _classifierncp;

  // @override
  // void initState() {
  //   super.initState();
  //   // _classifier = Classifier();
  //   // _classifierncp = Classifierncp();
  // }

  Widget build(BuildContext context) {
    void randomGenerator() {
      var rng = new Random();
      int random1 = rng.nextInt(93);
      int random2 = rng.nextInt(93);
      while (random2 == random1) random2 = rng.nextInt(93);
      int random3 = rng.nextInt(93);
      while (random3 == random1 || random3 == random2)
        random3 = rng.nextInt(93);
      int random4 = rng.nextInt(93);
      while (random4 == random1 || random4 == random2 || random4 == random3)
        random4 = rng.nextInt(93);
      int random5 = rng.nextInt(93);
      while (random5 == random1 ||
          random5 == random2 ||
          random5 == random3 ||
          random5 == random4) random5 = rng.nextInt(93);

      bannerList = [
        mobiles[random1],
        mobiles[random2],
        mobiles[random3],
        mobiles[random4],
        mobiles[random5],
      ];
    }

    randomGenerator();
    void dialogue(context) {
      showDialog(
        context: context,
        builder: (ctx) {
          return AlertDialog(
            content: Text('Please Select All Options'),
            title: Text('Oops!'),
            backgroundColor: Colors.grey[800],
            actions: [
              FlatButton(
                child: Text(
                  'OK',
                  style: TextStyle(color: kPrimaryColor, fontSize: 15),
                ),
                onPressed: () {
                  Navigator.of(ctx).pop();
                },
              ),
            ],
          );
        },
      );
    }

    void dialogue2(context) {
      showDialog(
        context: context,
        builder: (ctx) {
          return AlertDialog(
            content: Text('First & second priority features can\'t be same'),
            title: Text('Oops!'),
            backgroundColor: Colors.grey[800],
            actions: [
              FlatButton(
                child: Text(
                  'OK',
                  style: TextStyle(color: kPrimaryColor, fontSize: 15),
                ),
                onPressed: () {
                  Navigator.of(ctx).pop();
                },
              ),
            ],
          );
        },
      );
    }

    var result = Provider.of<FilterPage>(context).filterListResult;
    // print("result = ");
    // print(result);
    var filters = Provider.of<FilterPage>(context).filterList;
    List keys = filters.keys.toList();

    // Price Map
    Map<String, int> priceMap = {
      'Below ₹10k': 1,
      '₹10k-₹12k': 2,
      '₹12k-₹15k': 3,
      '₹15k-₹20k': 4,
      '₹20k-₹25k': 5,
      '₹25k-₹30k': 6,
      '₹30k-₹40k': 7,
      '₹40k-₹50k': 8,
      '₹50-₹70k': 9,
      '₹70k-₹100k': 10,
      '₹100k-₹120k': 11,
      'Above ₹120k': 12
    };
    var price;
    String myText = '';
    String myText2 = '';
    String myText3 = '';
    String myText4 = '';
    int z = 0;
    flagChinese = 0;
    double flagPer = 0;
    double flagBattery = 0;
    double flagCamera = 0;
    double flagDisplay = 0;
    double flagCharging = 0;

    input = [
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    ];

    ////////////////////////   LIST OF LABELS

    List<String> labels = [
      'MI',
      'OPPO',
      'Realme',
      'ASUS',
      'ONEPLUS',
      'APPLE',
      'GOOGLE',
      'POCO',
      'SAMSUNG',
      'MOTOROLA',
      'Vivo'
    ];
    List<String> labelsncp = [
      'ASUS',
      'APPLE',
      'GOOGLE',
      'SAMSUNG',
      'MOTOROLA',
    ];

    List<int> noOfModels = [9, 3, 16, 2, 7, 11, 6, 5, 26, 5, 4];
    List<int> noOfModelsncp = [2, 11, 6, 26, 5];

    int _changeText(int maxIndex) {
      print('ghuste hi change text');
      _recommend = [];
      // loadAsset() async {
      //   print("load asset");
      //   final myData =
      //       await rootBundle.loadString("assets/Final Model Dataset.csv");
      //   csvTable = CsvToListConverter().convert(myData);

      //   data = csvTable;
      //   print("LOAD ASSET DATA PRINT = ");
      //   print(data);

      // }

      // loadAsset();
      // print("before");
      // print(data);
      // print("after");
      // print(csvTable[1][19]);

      // print(csvTable[1][20].toString());
      // print(input);
      List<double> prediction;
      // print("SDvsdfvbfsbdfsbfd00");
      // createAlbum();
      print('Hi AU');
      print(input);
      // if (flagChinese == 1) {
      //   final result = _classifier.classify(input);
      //   prediction = result;
      // } else if (flagChinese == 0) {
      //   var resultncp = _classifierncp.classifyncp(input);
      //   prediction = resultncp;
      // }

      // print(prediction);
      // print(prediction.reduce(max));
      // var maxIndex = 0;
      print("oopar");
      // sleep(new Duration(seconds: 10));
      // createAlbum();
      print("niche");
      // for (double i in prediction) {
      //   // max element
      //   if (i == prediction.reduce(max)) {
      //     // of prediction
      //     break;
      //   }
      //   maxIndex += 1;
      // }
      print(maxIndex);

      setState(() {
        // loadAsset();
        // print(csvTable);
        if (flagChinese == 1) {
          if (maxIndex < labels.length) {
            // Printing Label
            myText = labels[
                maxIndex]; // according to     // maxIndex is the index of the company to be predicted
          } else {
            // prediction
            myText = "NO";
          }
        } else if (flagChinese == 0) {
          if (maxIndex < labelsncp.length) {
            // Printing Label
            myText = labelsncp[
                maxIndex]; // according to     // maxIndex is the index of the company to be predicted
          } else {
            // prediction
            myText = "NO";
          }
        }

        void findPhone() {
          // print("find phone");
          // print(csvTable);
          int increament = 0;
          // INCREAMENT is used to check only the phones of the predicted brand
          // print(csvTable[1][20].toString());
          var count = 0, maximum = 0, index = 0;
          for (var i = 1; i < 95; i++) {
            // print(i);
            // print(csvTable[i][19].toString());
            if (myText == csvTable[i][19].toString()) // loop to match brand
            {
              maximum = 0;
              if (flagChinese == 1) {
                increament = noOfModels[maxIndex];
              } else if (flagChinese == 0) {
                increament = noOfModelsncp[maxIndex];
              }
              // print(increament);
              for (var j = i;
                  j < i + increament;
                  j++) // loop to check only the phones of the predicted brand
              {
                // print(j);
                // print(maxIndex);
                count = 0;
                // print(csvTable[j][_value]);
                if (csvTable[j][price] ==
                    input[0][price - 1]) // matching the price
                {
                  // print("hello");
                  for (var k = 12; k < 17; k++) {
                    // loop to check which features are matching of the jth phone of ith brand
                    // print(k);
                    if (input[0][k] == csvTable[j][k + 1]) {
                      count++;
                    }
                  }
                  if (count > maximum) {
                    index = j;
                    maximum = count;
                  }
                }
              }

              break;
            }
          }
          String tempmyText = '';
          // print(index);

          myText = csvTable[index][0].toString();
          _recommend.add(mobiles[index - 1]);
          // print(_recommend[0].name);  //First recommended Phone
          tempmyText = myText;
          if (myText ==
                  'Please consider other options or go for a chinese smartphone' &&
              input[0][16] == 0) {
            input[0][16] = 1;
            z = 1; // this was to change charging to 1 if any we didn't find any non-chinese phone
            //countNavigate=0;
            _changeText(maxIndex);
          }
          if (z == 1) {
            return;
          }

          var map = new SortedMap<int, double>(Ordering.byValue());
          // map = SortedMap(Ordering.byMappedValue((v) => 2);
          // map.forEach((k, v) => print("Key : $k, Value : $v"));

          // Initially we were storing name : rating as key : value in map
          // We are storing the index : rating ass key : value in map
          // Then we are adding all the index to _recommend

          if (myText !=
              "Please consider other options or go for a chinese smartphone") {
            for (int i = 1; i < 95; i++) // loop to print other phones
            {
              if (flagChinese == 1) {
                if (csvTable[i][price] ==
                    input[0][price -
                        1]) // checking the inputted price column with the same column in csvTable
                {
                  if (result['First Priority Feature : '][0] == 'Performance' &&
                      csvTable[i][20][0] == 'p' &&
                      csvTable[i][0] != myText) {
                    // map.addAll({csvTable[i][0]: csvTable[i][21]});
                    map.addAll({i: csvTable[i][21] * 1.0});
                  } else if (result['First Priority Feature : '][0] ==
                          'Camera' &&
                      (csvTable[i][20][0] == 'c' ||
                          csvTable[i][20][1] == 'c') &&
                      csvTable[i][0] != myText) {
                    map.addAll({i: csvTable[i][21] * 1.0});
                  } else if (result['First Priority Feature : '][0] ==
                          'Battery' &&
                      (csvTable[i][20][0] == 'b' ||
                          csvTable[i][20][1] == 'b' ||
                          csvTable[i][20][2] == 'b') &&
                      csvTable[i][0] != myText) {
                    map.addAll({i: csvTable[i][21] * 1.0});
                  }
                }
              } else {
                if (csvTable[i][price] ==
                    input[0][price -
                        1]) // checking the inputted price column with the same column in csvTable
                {
                  if (result['First Priority Feature : '][0] == 'Performance' &&
                      csvTable[i][20][0] == 'p' &&
                      csvTable[i][18] == 0) {
                    map.addAll({i: csvTable[i][21] * 1.0});
                  } else if (result['First Priority Feature : '][0] ==
                          'Camera' &&
                      (csvTable[i][20][0] == 'c' ||
                          csvTable[i][20][1] == 'c') &&
                      csvTable[i][18] == 0) {
                    map.addAll({i: csvTable[i][21] * 1.0});
                  } else if (result['First Priority Feature : '][0] ==
                          'Battery' &&
                      (csvTable[i][20][0] == 'b' ||
                          csvTable[i][20][1] == 'b' ||
                          csvTable[i][20][2] == 'b') &&
                      csvTable[i][18] == 0) {
                    map.addAll({i: csvTable[i][21] * 1.0});
                  }
                }
              }
            }
            map.addAll(
                {-1: -1 * 1.0}); // we have added extra entry to find the length
            // of the map below

            // var map1 = map.values.toList().sort();
            // print(map1);
            // map.forEach((k, v) => print("Key : $k, Value : $v"));
            // Emptying the links before next prediction
            // print("mytext=");
            // print(myText);

            int tempcount = 0;
            int mapLength = 0;
            int mapLengthCounter = 0;

            for (var k in map.keys) {
              mapLength++;
            }
            for (var k in map.keys) {
              mapLengthCounter++;

              // print("tempmyText = ");
              // print(tempmyText);

              if (map[k] != -1.0 &&
                  csvTable[k][0] != tempmyText &&
                  tempcount < 3 &&
                  mapLengthCounter >= mapLength - 2) {
                // print("k = ");
                // print(k);
                // print("value = ");
                // print(map[k]);
                // map.forEach((k, v) => print("Key : $k, Value : $v"));
                if (tempcount == 0) {
                  // myText2 = k;
                  myText2 = csvTable[k][0];
                  // print(myText2);
                  if (myText2 != '') _recommend.add(mobiles[k - 1]);
                }
                if (tempcount == 1) {
                  myText3 = csvTable[k][0];
                  // print(myText3);
                  if (myText3 != '') _recommend.add(mobiles[k - 1]);
                }
                if (tempcount == 2) {
                  myText4 = csvTable[k][0];
                  // print(myText4);
                  if (myText4 != '') _recommend.add(mobiles[k - 1]);
                }
                // myText += '\n' + k;
                tempcount++;
              }
            }

            // showAlertDialog(context);

            // return index;
          }
        }

        findPhone();

        if (z == 1) {
          input[0][16] = 0;
        }

        z = 0;
      });
      return 0;
    }

    Future<void> mainfunction() {
      return createAlbum().then((maxIndex) {
        return _changeText(maxIndex);
      }).then((value) {
        Navigator.of(context)
            .pushNamed(RecommendationPage.Route, arguments: result);
      });
    }

    return Scaffold(
      bottomNavigationBar: BottomBar(
        current: 1,
        routes: routes,
      ),
      appBar: AppBar(
        automaticallyImplyLeading: false,
        backgroundColor: kPrimaryColor,
        title: Text(
          "Select Filter",
          style: bodyText(context),
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          child: Column(
            children: [
              for (var i = 0; i < filters.length; i++)
                FilterWidget(
                  result: result,
                  title: keys[i],
                  options: filters[keys[i]],
                ),
              Center(
                child: RaisedButton.icon(
                  padding: EdgeInsets.symmetric(horizontal: 30, vertical: 15),
                  onPressed: () {
                    // print("result = ");
                    // print(result);
                    bool empty = false;
                    for (var i = 0; i < result.length; i++) {
                      if (result[keys[i]].isEmpty) {
                        empty = true;
                        break;
                      }
                    }

                    if (result['First Priority Feature : '][0] ==
                        result['Second Priority Feature : '][0]) {
                      dialogue2(context);
                    } else if (!empty) {
/////////////////////////////////////////////////////////////////////////////////////

                      loadAsset(); // For loading the csvTable for matching
                      // print("before");
                      // print(csvTable);
                      // print("after");
                      // _getData();

                      //PRICE
                      input[0][0] = 0;
                      input[0][1] = 0;
                      input[0][2] = 0;
                      input[0][3] = 0;
                      input[0][4] = 0;
                      input[0][5] = 0;
                      input[0][6] = 0;
                      input[0][7] = 0;
                      input[0][8] = 0;
                      input[0][9] = 0;
                      input[0][10] = 0;
                      input[0][11] = 0;

                      price = priceMap[result["Budget"][0]];
                      // print("price = ");
                      // print(price);
                      input[0][price - 1] = 1;

                      if (price == 12) {
                        flagCharging = 1;
                        flagCamera = 3;
                        input[0][13] = flagCamera;
                        input[0][16] = flagCharging;
                      }

                      //////////////////////////////////////////
                      // CHINESE

                      if (result['Are You Fine With Chinese Smartphones?'][0] ==
                          'Yes') {
                        flagChinese = 1;
                        model_selection = 'modelwc6.tflite';
                      } else {
                        flagChinese = 0;
                        model_selection = 'modelncp5.tflite';
                      }

                      //////////////////////////////////////////
                      // MOST IMP FEATURE

                      // PERFORMANCE

                      if (result['First Priority Feature : '][0] ==
                          'Performance') {
                        if (price > 4) // above 20k
                        {
                          flagPer = 2;
                        } else if (price <= 4) // 10k to 20k
                        {
                          flagPer = 1;
                        }
                        input[0][12] = flagPer;

                        if (result['Second Priority Feature : '][0] ==
                            'Camera') {
                          if (price == 1) // below 10k
                          {
                            flagBattery = 2;
                          } else {
                            flagBattery = 1;
                          }

                          input[0][14] = flagBattery;
                        } else if (result['Second Priority Feature : '][0] ==
                            'Battery') {
                          if (price <= 3) // below 15k
                          {
                            flagCamera = 0;
                          } else if (price <= 6) // below 30k
                          {
                            flagCamera = 1;
                          } else if (price > 6 && price <= 9) // above 30k
                          {
                            flagCamera = 2;
                          } else if (price > 9) // above 70k
                          {
                            flagCamera = 3;
                          }
                          input[0][13] = flagCamera;
                        }
                      }

                      // CAMERA

                      if (result['First Priority Feature : '][0] == 'Camera') {
                        if (price > 6) // above 30k
                        {
                          flagCamera = 3;
                        } else if (price == 4 ||
                            price == 5 ||
                            price == 6) // 15k to 30k
                        {
                          flagCamera = 2;
                        } else if (price == 3) // 12k to 15k
                        {
                          flagCamera = 1;
                        } else {
                          flagCamera = 1;
                        }
                        input[0][13] = flagCamera;

                        if (result['Second Priority Feature : '][0] ==
                            'Performance') {
                          if (price == 1) {
                            flagBattery = 2;
                          } else {
                            flagBattery = 1;
                          }
                          input[0][14] = flagBattery;
                        }
                        if (result['Second Priority Feature : '][0] ==
                            'Battery') {
                          if (price <= 1) // below 10k
                          {
                            flagPer = 0;
                          } else if (price <= 8) // below 50k
                          {
                            flagPer = 1;
                          } else if (price > 8) // above 50k
                          {
                            flagPer = 2;
                          }
                          input[0][12] = flagPer;
                        }
                      }

                      // BATTERY

                      if (result['First Priority Feature : '][0] == 'Battery') {
                        flagBattery = 2;
                        if (flagChinese == 1 && price == 6) //25k to 30k
                        {
                          flagBattery = 1;
                        }
                        if (result['Second Priority Feature : '][0] ==
                            'Camera') {
                          if (price <= 1) // below 10k
                          {
                            flagPer = 0;
                          } else if (price <= 6 && price > 1) // 10k -  30k
                          {
                            flagPer = 1;
                          } else if (price > 6) // above 30k
                          {
                            flagPer = 2;
                          }
                          input[0][12] = flagPer;
                        }

                        if (result['Second Priority Feature : '][0] ==
                            'Performance') {
                          if (price ==
                              5) //for passing battery coreectly when first-camera second-perfo then again first-battery
                          {
                            flagPer = 1;
                          }
                          if (price <= 5) // below 25k
                          {
                            flagCamera = 1;
                          } else if (price <= 8 && price > 5) // below 25k
                          {
                            flagCamera = 2;
                          } else if (price > 8) // above 50k
                          {
                            flagCamera = 3;
                          }
                          input[0][13] = flagCamera;
                          input[0][12] = flagPer;
                        }
                        input[0][14] = flagBattery;
                      }

                      //////////////////////////////////////////
                      // SECOND MOST IMP FEATURE

                      // PERFORMANCE

                      if (result['Second Priority Feature : '][0] ==
                          'Performance') {
                        if (result['First Priority Feature : '][0] ==
                            'Camera') {
                          // print("hellohellohello");
                          if (price == 5) // 20k to 25k
                          {
                            flagPer = 2;
                            flagBattery = 1;
                          } else if (price <= 7) // till 40k
                          {
                            flagPer = 1;
                            flagBattery = 1;
                          } else if (price > 7) // above 40k
                          {
                            flagPer = 2;
                            flagBattery = 1;
                          }
                          input[0][12] = flagPer;
                          input[0][14] = flagBattery;
                          // print("BATTERY");
                          // print(flagBattery);
                        }
                        if (result['First Priority Feature : '][0] ==
                            'Battery') {
                          if (price <= 7) // till 40k
                          {
                            flagPer = 1;
                          } else if (price > 7) // above 40k
                          {
                            flagPer = 2;
                          }

                          if (price == 1) // below 10k
                          {
                            flagCamera = 0;
                          } else if (price <= 5) // 10k to 25k
                          {
                            flagCamera = 1;
                          } else if (price <= 8 && price > 5) // below 25k
                          {
                            flagCamera = 2;
                          } else if (price > 8) // above 50k
                          {
                            flagCamera = 3;
                          }
                          input[0][12] = flagPer;
                          input[0][13] = flagCamera;
                        }
                      }

                      // CAMERA

                      if (result['Second Priority Feature : '][0] == 'Camera') {
                        if (result['First Priority Feature : '][0] ==
                            'Performance') {
                          if (price <= 4) // below 15k
                          {
                            flagCamera = 1;

                            if (price == 1) {
                              flagBattery = 2;
                            } else {
                              flagBattery = 1;
                            }
                          } else if (price > 4 && price <= 8) // 15k to 50k
                          {
                            flagCamera = 2;

                            flagBattery = 1;
                          } else if (price > 8) // Above 50k
                          {
                            flagCamera = 3;
                            flagBattery = 1;
                          }
                          input[0][14] = flagBattery;
                          input[0][13] = flagCamera;
                        }

                        if (result['First Priority Feature : '][0] ==
                            'Battery') {
                          if (price <= 2) // below 12k
                          {
                            flagCamera = 0;
                          } else if (price == 3) // 12k to 15k
                          {
                            flagCamera = 1;
                          } else if (price >= 4 && price <= 8) // 15k to 50k
                          {
                            flagCamera = 2;
                          } else if (price > 8) // Above 50k
                          {
                            flagCamera = 3;
                          }

                          if (price <= 1) // below 10k
                          {
                            flagPer = 0;
                          } else if (price <= 6 && price > 1) // less than 30k
                          {
                            flagPer = 1;
                          } else if (price > 6) // above 30k
                          {
                            flagPer = 2;
                          }
                          input[0][13] = flagCamera;
                          input[0][12] = flagPer;
                        }
                      }

                      // BATTERY

                      if (result['Second Priority Feature : '][0] ==
                          'Battery') {
                        if (result['First Priority Feature : '][0] ==
                            'Performance') {
                          if (price == 1) // below 10k
                          {
                            flagBattery = 2;
                          } else if (price ==
                              3) // 12k to 15k to show note 9 pro
                          {
                            flagBattery = 2;
                          }
                          if (price > 1 && price <= 6) // below 30k
                          {
                            flagBattery = 1;
                          } else if (price ==
                              9) // 50k to 70k to show OP8pro instead of OP7T pro
                          {
                            flagBattery = 2;
                          } else if (price > 6) // above 30k
                          {
                            flagBattery = 1;
                          }
                          if (price == 8) {
                            // 40k to 50k
                            flagBattery = 2;
                          }

                          if (price <= 3) // below 15k
                          {
                            flagCamera = 0;
                          } else if (price <= 6) // below 30k
                          {
                            flagCamera = 1;
                          } else if (price == 7) // above 30k
                          {
                            flagCamera = 2;
                          } else if (price >= 8) // above 70k
                          {
                            flagCamera = 3;
                          }
                          // if (price == 8) {
                          //   // 40k to 50k to show S20 FE
                          //   flagCamera = 3;
                          // }
                          input[0][13] = flagCamera;
                          input[0][14] = flagBattery;
                        }

                        if (result['First Priority Feature : '][0] ==
                            'Camera') {
                          if (price == 1) // below 10k
                          {
                            flagBattery = 2;
                          } else if (price <= 6) // 10k to 30k
                          {
                            flagBattery = 1;
                          } else if (price > 6) // above 30k
                          {
                            flagBattery = 2;
                          }

                          if (price <= 2) // below 12k
                          {
                            flagPer = 0;
                          } else if (price ==
                              5) // 20k to 25k for showing realme X3 instead of nothing
                          {
                            flagPer = 2;
                          } else if (price > 2 && price <= 8) // below 50k
                          {
                            flagPer = 1;
                          } else if (price > 8) // above 50k
                          {
                            flagPer = 2;
                          }
                          input[0][12] = flagPer;
                          input[0][14] = flagBattery;
                        }
                      }

                      //////////////////////////////////////////
                      ///
                      ///DISPLAY
                      ///

                      if (result['Display'][0] == "Great") {
                        flagDisplay = 0;
                        if (price <= 2) {
                          flagDisplay = 0;
                        } else if (price == 3 && flagChinese == 1) {
                          flagDisplay = 0;
                        } else if (price <= 7 || price > 8) //above 30k
                        {
                          flagDisplay = 1;
                        }

                        input[0][15] = flagDisplay;
                      }

                      if (result['Display'][0] == "Amazing") {
                        if (price <= 2) // below 12k
                        {
                          flagDisplay = 0;
                        } else // above 12k
                        {
                          flagDisplay = 1;
                        }
                        input[0][15] = flagDisplay;
                      }

                      //////////////////////////////////////////
                      ///
                      /// CHARGING
                      ///

                      if (result['Charging'][0] == 'Fast') {
                        flagCharging = 0;
                        if (price == 3) {
                          // 12k to 15k
                          flagCharging = 1;
                        }
                        if (price == 5) {
                          // 20k to 25k
                          flagCharging = 1;
                        } else if (price == 4 &&
                            result['First Priority Feature : '][0] ==
                                'Camera') {
                          flagCharging = 1;
                        }
                        if (price == 8) {
                          // 40k to 50k
                          flagCharging = 1;
                        }
                        if (price == 10 || price == 12) {
                          flagCharging = 1;
                        }

                        input[0][16] = flagCharging;
                      }

                      if (result['Charging'][0] == 'Super Fast') {
                        flagCharging = 1;
                        // print("shedtherhehehehd");
                        if (price <= 2 && flagChinese == 0) // BELOW 12k
                        {
                          flagCharging = 0;
                        } else if (price == 6 && flagChinese == 0) {
                          flagCharging = 0;
                        }

                        input[0][16] = flagCharging;
                      }
                      //////////////////////////////////////////

                      input[0][12] = flagPer;
                      input[0][13] = flagCamera;
                      input[0][14] = flagBattery;
                      input[0][15] = flagDisplay;
                      input[0][16] = flagCharging;

                      if (price == 6 && flagChinese == 0) {
                        input = [
                          [
                            0.0,
                            0.0,
                            0.0,
                            0.0,
                            0.0,
                            1.0,
                            0.0,
                            0.0,
                            0.0,
                            0.0,
                            0.0,
                            0.0,
                            1.0,
                            3.0,
                            1.0,
                            1.0,
                            0.0
                          ]
                        ];
                      }

                      // print("input");
                      print(input);

                      // createAlbum();
                      // _changeText();
                      mainfunction();

                      // print(mobiles[0].name);
                      // print("myText = " + myText);
                      // print("myText2 = " + myText2);
                      // print("myText3 = " + myText3);
                      // print("myText4 = " + myText4);
                      print("result");
                      print(result);
                      print(_recommend);
/////////////////////////////////////////////////////////////////////////////////////
                      // Navigator.of(context).pushNamed(RecommendationPage.Route,
                      // arguments: result);
                    } else
                      dialogue(context);
                  },
                  icon: Icon(Icons.search_rounded),
                  label: Text(
                    'Find',
                    style: Theme.of(context).textTheme.headline6,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  List<FilterPage> get rec {
    return _recommend;
  }
}

class FilterWidget extends StatefulWidget {
  const FilterWidget({
    @required this.result,
    @required this.options,
    @required this.title,
  });
  final String title;
  final List options;
  final Map<String, List> result;

  @override
  _FilterWidgetState createState() => _FilterWidgetState();
}

class _FilterWidgetState extends State<FilterWidget> {
  @override
  Widget build(BuildContext context) {
    List values = widget.result[widget.title];
    return Container(
      alignment: Alignment.centerLeft,
      padding: EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.start,
        children: [
          Text(
            widget.title,
            style: Theme.of(context).textTheme.headline5,
          ),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.start,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (var i = 0; i < widget.options.length; i++)
                  Container(
                    margin: EdgeInsets.symmetric(horizontal: 5, vertical: 5),
                    child: FilterChip(
                      tooltip: widget.title,
                      backgroundColor: kAccentColor,
                      selectedColor: kPrimaryColor,
                      labelStyle: Theme.of(context)
                          .textTheme
                          .headline6
                          .copyWith(
                              color: widget.result[widget.title]
                                      .contains(widget.options[i])
                                  ? Colors.white
                                  : Colors.black),
                      padding:
                          EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                      selected: values.contains(widget.options[i]),
                      label: Text(widget.options[i]),
                      onSelected: (value) {
                        if (value && widget.options.isNotEmpty) {
                          setState(() {
                            values.clear();
                            values.add(widget.options[i]);
                          });
                        } else {
                          setState(() {
                            values.clear();
                          });
                        }
                      },
                    ),
                  ),
              ],
            ),
          )
        ],
      ),
    );
  }
}

///////////////////////////////////////////////     CLASSIFIER CLASS
/// FOR ALL PHONES(CHINESE AND NON-CHINESE)
/// for prediction
/// giving input to the model using an interpreter
/// and giving output

// class Classifier {
//   // name of the model file

//   final _modelFile = 'modelwc6.tflite';

//   // TensorFlow Lite Interpreter object
//   Interpreter _interpreter;

//   Classifier() {
//     // Load model when the classifier is initialized.
//     _loadModel();
//   }

//   void _loadModel() async {
//     // Creating the interpreter using Interpreter.fromAsset
//     _interpreter = await Interpreter.fromAsset(_modelFile);
//     print('Interpreter loaded successfully');
//   }

//   List<double> classify(List<List<double>> x) {
//     // print("x =");
//     // print(x);
//     List<List<double>> input = x;
//     // print(input);

//     // output of shape [1,11].
//     var output = List<double>(11).reshape([1, 11]);
//     // print(output.shape);

//     // The run method will run inference and
//     // store the resulting values in output.
//     _interpreter.run(input, output);

//     return output[0];
//   }
// }

// ///////////////////////////////////////////////     CLASSIFIERNCP CLASS
// /// FOR NON CHINESE PHONES
// /// for prediction
// /// giving input to the model using an interpreter
// /// and giving output

// class Classifierncp {
//   // name of the model file

//   final _modelFile = 'modelncp5.tflite';

//   // TensorFlow Lite Interpreter object
//   Interpreter _interpreterncp;

//   Classifierncp() {
//     // Load model when the classifier is initialized.
//     _loadModelncp();
//   }

//   void _loadModelncp() async {
//     // Creating the interpreter using Interpreter.fromAsset
//     _interpreterncp = await Interpreter.fromAsset(_modelFile);
//     print('Interpreter loaded successfully');
//   }

//   List<double> classifyncp(List<List<double>> xncp) {
//     // print(xncp);
//     List<List<double>> inputncp = xncp;
//     // print(inputncp);

//     // output of shape [1,11].
//     var outputncp = List<double>(5).reshape([1, 5]);
//     // print(outputncp.shape);

//     // The run method will run inference and
//     // store the resulting values in output.
//     _interpreterncp.run(inputncp, outputncp);

//     return outputncp[0];
//   }
// }
// class Album {
//   // Other functions and properties relevant to the class
//   // ......
//   /// Json is a Map<dynamic,dynamic> if i recall correctly.
//   static fromJson(json): Album {
//     Album p = new Album()
//     p.name = ...
//     return p
//   }
// }
// class Album {
//   final String title;

//   Album({this.title});

//   factory Album.fromJson(Map<String, dynamic> json) {
//     return Album(
//       title: json['prediction'],
//     );
//   }
// }
Future<int> createAlbum() async {
  print('ghuste hi create album');
  if (flagChinese == 1) {
    final http.Response response = await http.post(
      'https://recsyapi.herokuapp.com/predict',
      headers: <String, String>{
        'Content-Type': 'application/json',
      },
      body: jsonEncode([
        {
          "Below 10000": input[0][0],
          "10000-12000": input[0][1],
          "12000 - 15000": input[0][2],
          "15000-20000": input[0][3],
          "20000-25000": input[0][4],
          "25000-30000": input[0][5],
          "30000-40000": input[0][6],
          "40000-50000": input[0][7],
          "50000-70000": input[0][8],
          "70000-100000": input[0][9],
          "100000-120000": input[0][10],
          "Above 120000": input[0][11],
          "Performance(3)": input[0][12],
          "Camera(4)": input[0][13],
          "Battery(3)": input[0][14],
          "Display(2)": input[0][15],
          "Charging(2)": input[0][16]
        }
      ]),
    );
    print('response received');
    if (response.statusCode == 200) {
      // If the server did return a 201 CREATED response,
      // then parse the JSON.
      // print(Album.fromJson(jsonDecode(response.body)));
      String apiout = jsonDecode(response.body)['prediction'];
      if (apiout.length > 3)
        apiout = apiout[1] + apiout[2];
      else
        apiout = apiout[
            1]; //[1] because prediction fromat is ['[','number',']'] if add more brands then 10 should be taken with 1 and 2 index by concatenating
      maxIndex = int.parse(apiout);
      print(maxIndex);
      print("infunction");
      return maxIndex;
    } else {
      // If the server did not return a 201 CREATED response,
      // then throw an exception.
      throw Exception('Failed to load album');
    }
  } else {
    final http.Response response = await http.post(
      'https://recsyapi.herokuapp.com/predictncp',
      headers: <String, String>{
        'Content-Type': 'application/json',
      },
      body: jsonEncode([
        {
          "Below 10000": input[0][0],
          "10000-12000": input[0][1],
          "12000 - 15000": input[0][2],
          "15000-20000": input[0][3],
          "20000-25000": input[0][4],
          "25000-30000": input[0][5],
          "30000-40000": input[0][6],
          "40000-50000": input[0][7],
          "50000-70000": input[0][8],
          "70000-100000": input[0][9],
          "100000-120000": input[0][10],
          "Above 120000": input[0][11],
          "Performance(3)": input[0][12],
          "Camera(4)": input[0][13],
          "Battery(3)": input[0][14],
          "Display(2)": input[0][15],
          "Charging(2)": input[0][16]
        }
      ]),
    );
    print('response received');
    if (response.statusCode == 200) {
      // If the server did return a 201 CREATED response,
      // then parse the JSON.
      // print(Album.fromJson(jsonDecode(response.body)));
      String apiout = jsonDecode(response.body)['prediction'];
      if (apiout.length > 3)
        apiout = apiout[1] + apiout[2];
      else
        apiout = apiout[
            1]; //[1] because prediction fromat is ['[','number',']'] if add more brands then 10 should be taken with 1 and 2 index by concatenating
      maxIndex = int.parse(apiout);
      print(maxIndex);
      print("infunction");
      return maxIndex;
    } else {
      // If the server did not return a 201 CREATED response,
      // then throw an exception.
      throw Exception('Failed to load album');
    }
  }
}
