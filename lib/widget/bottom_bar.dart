import 'package:flutter/material.dart';
import 'package:mobile_recommender/export.dart';

class BottomBar extends StatefulWidget {
  const BottomBar({
    Key key,
    @required this.current,
    @required this.routes,
  }) : super(key: key);

  final int current;
  final List<String> routes;

  @override
  _BottomBarState createState() => _BottomBarState();
}

class _BottomBarState extends State<BottomBar> {
  @override
  Widget build(BuildContext context) {
    int _current = widget.current;
    return BottomNavigationBar(
      backgroundColor: Colors.black,
      currentIndex: _current,
      onTap: (value) async {
        setState(() {
          _current = value;
        });
        if (_current != widget.current) {
          var data = await Navigator.of(context)
              .pushReplacementNamed(widget.routes[_current]);
          // print(data);
        }
      },
      selectedItemColor: kPrimaryColor,
      unselectedItemColor: kAccentColor,
      items: [
        BottomNavigationBarItem(
          icon: Icon(Icons.home),
          label: 'Home',
        ),
        BottomNavigationBarItem(
          icon: Icon(Icons.search),
          label: 'Search',
        ),
        BottomNavigationBarItem(
          icon: Icon(Icons.account_circle_rounded),
          label: 'Profile',
        ),
      ],
    );
  }
}
