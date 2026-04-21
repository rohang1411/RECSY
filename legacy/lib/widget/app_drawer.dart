import 'package:flutter/material.dart';
import 'package:mobile_recommender/export.dart';

class AppDrawer extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final _mob = Provider.of<FilterPage>(context).comparePhone;

    return Drawer(
      elevation: 10,
      child: Container(
        color: Colors.black,
        child: Column(
          children: [
            DrawerHeader(
              decoration: BoxDecoration(
                color: kPrimaryColor,
              ),
              padding: EdgeInsets.zero,
              child: Container(
                padding: EdgeInsets.all(20),
                alignment: Alignment.bottomLeft,
                width: double.infinity,
                child: Text(
                  'Recsy',
                  style: TextStyle(fontSize: 40),
                ),
                color: kPrimaryColor,
              ),
            ),
            Container(
              child: Column(
                children: [
                  ListTile(
                    leading: CircleAvatar(
                      backgroundColor: kPrimaryColor,
                      foregroundColor: Colors.white,
                      child: Text('V/S'),
                    ),
                    title: Text('Compare'),
                    onTap: () {
                      Navigator.of(context).pushNamed(
                        SearchPage.Route,
                        arguments: {
                          'mobiles': _mob,
                          'selected': 0,
                          'compare': true
                        },
                      );
                    },
                  ),
                  Divider(
                    color: Colors.grey,
                    endIndent: 30,
                  ),
                  ListTile(
                    onTap: () {
                      Navigator.of(context).pushNamed(AboutUs.Route);
                    },
                    leading: Icon(
                      Icons.supervisor_account_rounded,
                      size: 40,
                      color: kPrimaryColor,
                    ),
                    title: Text('About Us'),
                  ),
                  Divider(
                    color: Colors.grey,
                    endIndent: 30,
                  ),
                  ListTile(
                    onTap: () {
                      Navigator.of(context).pushNamed(ContactUs.Route);
                    },
                    leading: Icon(
                      Icons.mail,
                      size: 40,
                      color: kPrimaryColor,
                    ),
                    title: Text('Contact Us'),
                  ),
                ],
              ),
            )
          ],
        ),
      ),
    );
  }
}
