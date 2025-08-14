import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_database/firebase_database.dart';
import 'package:mobile_recommender/export.dart';
import 'package:flutter/material.dart';

class DescriptionButton extends StatefulWidget {
  const DescriptionButton({
    Key key,
    @required this.mobile,
  }) : super(key: key);

  final FilterPage mobile;

  @override
  _DescriptionButtonState createState() => _DescriptionButtonState();
}

class _DescriptionButtonState extends State<DescriptionButton> {
  final FirebaseAuth _auth = FirebaseAuth.instance;
  final DatabaseReference dbRef =
      FirebaseDatabase.instance.reference().child("users");
  void writeFav(List<String> favIDlist) async {
    final User user = await _auth.currentUser;
    final uid = user.uid;
    dbRef.child(uid).update({'Favourites': favIDlist});
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceAround,
      children: [
        FlatButton.icon(
          onPressed: () {
            setState(() {
              Provider.of<FilterPage>(context, listen: false)
                  .changeFav(widget.mobile.id);
              List<FilterPage> _fav =
                  Provider.of<FilterPage>(context, listen: false).favorites;
              List<String> _favID = [];

              for (int i = 0; i < _fav.length; i++) {
                _favID.add(_fav[i].id);
              }
              // print(_favID);
              writeFav(_favID);
            });
          },
          icon: Icon(
            Icons.favorite,
            size: 40,
            color: widget.mobile.isFav ? kPrimaryColor : Colors.white,
          ),
          label: Text(
            'Favorite',
            style: TextStyle(
              color: widget.mobile.isFav ? kPrimaryColor : Colors.white,
            ),
          ),
        ),
        FlatButton.icon(
          onPressed: () {
            setState(() {
              Provider.of<FilterPage>(context, listen: false)
                  .randomCompare(0, widget.mobile);
              Navigator.of(context).pushNamed(SearchPage.Route,
                  arguments: {'compare': true, 'selected': 1});
            });
          },
          icon: CircleAvatar(
            backgroundColor: kPrimaryColor,
            foregroundColor: Colors.white,
            child: Text('V/S'),
          ),
          label: Text('Compare'),
        ),
      ],
    );
  }
}

class Descriptions extends StatelessWidget {
  const Descriptions({
    Key key,
    @required List keys,
    @required this.i,
    @required this.mobile,
    @required this.size,
  })  : _keys = keys,
        super(key: key);

  final List _keys;
  final int i;
  final FilterPage mobile;
  final Size size;

  @override
  Widget build(BuildContext context) {
    // print(mobile.specs[_keys[i]]);
    return Container(
      padding: EdgeInsets.fromLTRB(5, 5, 5, 0),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          FittedBox(child: Text(_keys[i])), // Box ki Heading
          if (_keys[i] != 'Performance')
            Icon(
              description[_keys[i]],
              size: 40,
            ),
          if (_keys[i] == 'Performance') // Beech ka icon
            Expanded(
              child: Container(
                  padding: EdgeInsets.all(8),
                  child: Image.asset(
                    'assets/cpu.png',
                    fit: BoxFit.cover,
                  )),
            ),
          FittedBox(
              child: Text(mobile.specs[_keys[i]])), // Box me niche wala text
        ],
      ),
      height: size.height * 0.11,
      width: size.height * 0.12,
      decoration: BoxDecoration(
        color: Color(0xff53C3CB),
        borderRadius: BorderRadius.circular(16),
      ),
    );
  }
}
