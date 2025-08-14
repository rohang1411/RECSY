import 'dart:collection';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_database/firebase_database.dart';
import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:mobile_recommender/export.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'login_sign.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'landing.dart';
import 'dart:convert';

class UserProfile extends StatefulWidget with ChangeNotifier {
  static const Route = '/user';

  @override
  _UserProfileState createState() => _UserProfileState();
}

class _UserProfileState extends State<UserProfile> {
  final FirebaseAuth _auth = FirebaseAuth.instance;
  final DatabaseReference dbRef =
      FirebaseDatabase.instance.reference().child("users");
  final FirebaseFirestore firestoreInstance = FirebaseFirestore.instance;

  String emailstring = '';
  String tempname = '';

  // String showName = '';

  // String newGetName() {
  //   var showName = getName();
  //   return showName.toString();
  // }

  // Map<dynamic, dynamic> userDataMap;
  // Future<String> getName() async {
  //   final User user = await _auth.currentUser;
  //   final uid = user.uid;
  //   dbRef.child(uid).once().then((DataSnapshot snapshot) async {
  //     print('Data : ${snapshot.value}');
  //     userDataMap = snapshot.value;
  //     print(snapshot.value);
  //     print(userDataMap['Name']);
  //     if (userDataMap['Name'] != null)
  //       return userDataMap['Name'].toString();
  //     else
  //       return 'User';
  //   });
  // }

  @override
  void initState() {
    // getName();
    super.initState();
    getUser().then((user) {
      print('Hi AU');
      if (user != null) {
        emailstring = user.email;
        // print(emailstring);
      }
      if (emailstring == '')
        tempname = '';
      else {
        for (int i = 0; i < emailstring.length; i++) {
          if (emailstring[i] == '@') {
            tempname = emailstring.substring(0, i);
          }
        }
      }
    });
  }

  Future<User> getUser() async {
    return await _auth.currentUser;
  }

  // String showName() {
  //   if (emailstring == '') return '';
  //   for (int i = 0; i < emailstring.length; i++) {
  //     if (emailstring[i] == '@') {
  //       tempname = emailstring.substring(0, i);
  //       print(tempname);
  //       return tempname;
  //       // break;
  //     }
  //   }
  // }

  @override
  void setState(fn) {
    // TODO: implement setState
    // showName();
  }

  @override
  Widget build(BuildContext context) {
    // String tempName = Provider.of<FilterPage>(context).nameGetter;
    // print('tempName = ' + tempName);
    // String temp = _LandingPageState.showName;
    List<FilterPage> _fav = Provider.of<FilterPage>(context).favorites;

    @override
    Future<void> resetPassword(String email) async {
      await _auth.sendPasswordResetEmail(email: email);
    }

    final size = MediaQuery.of(context).size;
    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: double.infinity,
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    PopupMenuButton(
                      onSelected: (value) async {
                        if (value == 1) {
                          SharedPreferences prefs =
                              await SharedPreferences.getInstance();

                          prefs.remove('email');
                          prefs.remove('name');
                          prefs.remove('fav');
                          prefs.remove('favList');
                          _fav = [];
                          for (int i = 0; i < mobiles.length; i++) {
                            mobiles[i].isFav = false;
                          }
                          Navigator.pushReplacement(
                              context,
                              MaterialPageRoute(
                                  builder: (BuildContext context) =>
                                      LoginPage()));
                        } else if (value == 0) {
                          resetPassword(emailstring);
                          Fluttertoast.showToast(
                              msg: "We have sent a password reset link to\n" +
                                  emailstring,
                              toastLength: Toast.LENGTH_SHORT,
                              gravity: ToastGravity.SNACKBAR,
                              timeInSecForIosWeb: 1,
                              backgroundColor: Colors.white70,
                              textColor: Colors.black,
                              fontSize: 16.0);
                        }
                      },
                      // TODO execute change password
                      icon: Icon(Icons.more_vert),
                      itemBuilder: (context) {
                        return [
                          PopupMenuItem(
                              value: 0, child: Text("Change Password")),
                          PopupMenuItem(value: 1, child: Text("Sign Out")),
                        ];
                      },
                    ),
                    Container(
                      margin: EdgeInsets.all(20),
                      alignment: Alignment.center,
                      child: Column(
                        children: [
                          CircleAvatar(
                            radius: 60,
                            backgroundColor: kPrimaryColor,
                            foregroundColor: Colors.white,
                            child: Icon(
                              Icons.person,
                              size: 90,
                            ),
                          ),
                          SizedBox(height: 10),
                          Text(
                            // showName(),
                            tempname,
                            // showName,
                            // show ? showName : 'User',
                            style:
                                Theme.of(context).textTheme.headline1.copyWith(
                                      fontSize: 30,
                                      color: Colors.white,
                                    ),
                          ),
                        ],
                      ),
                    )
                  ],
                ),
                height: size.height * 0.3,
                decoration: BoxDecoration(
                    color: Color(0xff3E3E3E),
                    borderRadius: BorderRadius.only(
                        bottomLeft: Radius.circular(50),
                        bottomRight: Radius.circular(50))),
              ),
              Padding(
                padding: const EdgeInsets.all(10.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(10, 10, 0, 10),
                      child: Text(
                        'Favorites',
                        style: TextStyle(fontSize: 30),
                      ),
                    ),
                    Container(
                      height: size.height * 0.5,
                      child: _fav.isEmpty
                          ? Center(
                              child: Padding(
                                padding: const EdgeInsets.all(20.0),
                                child: Column(
                                  children: [
                                    Icon(
                                      Icons.star_rounded,
                                      size: 80,
                                      color: Colors.grey,
                                    ),
                                    Text('No Favorites Yet')
                                  ],
                                ),
                              ),
                            )
                          : GridView.builder(
                              gridDelegate:
                                  SliverGridDelegateWithFixedCrossAxisCount(
                                crossAxisCount: 2,
                                childAspectRatio: 4 / 5,
                                crossAxisSpacing: 5,
                                mainAxisSpacing: 10,
                              ),
                              itemCount: _fav.length,
                              itemBuilder: (context, index) {
                                return SingleSectionItem(
                                  item: _fav[index],
                                  displayText: true,
                                  height: 300,
                                  width: size.width * 0.4,
                                );
                              },
                            ),
                    )
                  ],
                ),
              )
            ],
          ),
        ),
      ),
      bottomNavigationBar: BottomBar(current: 2, routes: routes),
    );
  }
}
