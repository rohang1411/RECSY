import 'package:flutter/material.dart';
import 'package:mobile_recommender/export.dart';
import 'package:url_launcher/url_launcher.dart';

class AboutUs extends StatelessWidget {
  static const Route = '/aboutUs';
  @override
  Widget build(BuildContext context) {
    return Scaffold(
        appBar: AppBar(
          title: Text(
            'About Us',
            style: bodyText(context),
          ),
        ),
        body: SafeArea(
          child: SingleChildScrollView(
            child: Container(
              alignment: Alignment.center,
              child: Column(
                mainAxisAlignment: MainAxisAlignment.spaceAround,
                children: [
                  Column(
                    mainAxisAlignment: MainAxisAlignment.spaceAround,
                    children: [
                      CircleAvatar(
                        backgroundColor: kPrimaryColor,
                        child: Image.asset(
                          'assets/spirallogo.png', // RECSY LOGO
                          fit: BoxFit.fitHeight,
                        ),
                        radius: 80,
                      ),
                      Text('\nA SPIRAL Product',
                          style: TextStyle(fontStyle: FontStyle.italic)),
                      Padding(
                        padding: const EdgeInsets.fromLTRB(15, 20, 15, 10),
                        child: Text(
                          // RECSY TEXT
                          'Recsy, the smart mobile recommender app helps you find the best smartphone for you. It analyses the user needs based on the features selected by the user, and ignites its AI engine to tailor the output perfectly.',
                          textAlign: TextAlign.center,
                          style: recsyText(context),
                        ),
                      ),
                      SizedBox(height: 10),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          InkWell(
                            onTap: () => launchUrl(Uri.parse(
                                'https://www.linkedin.com/company/spiraldevelopers/')),
                            child: Container(
                              height: 20,
                              width: 20,
                              alignment: Alignment.center,
                              child: Image.asset(
                                'assets/linkedin.png',
                              ),
                            ),
                          ),
                          SizedBox(width: 20),
                          InkWell(
                            onTap: () =>
                                launchUrl(Uri.parse('http://spiraldevelopers.unaux.com/')),
                            child: Container(
                              height: 20,
                              width: 20,
                              alignment: Alignment.center,
                              child: Image.asset(
                                'assets/globe.png',
                              ),
                            ),
                          ),
                        ],
                      )
                    ],
                  ),
                  SizedBox(height: 10),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                    children: [
                      CircleAvatar(
                        radius: 65,
                        // backgroundColor: Colors.white,
                        // foregroundColor: Colors.white,
                        child: Image.asset('assets/Spiral Logo1-01.png'),
                      ),
                      Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'S P I R A L',
                            style: spiralText(context),
                          ),
                          new Text(
                            'Where Technology Meet Dreams',
                            style: TextStyle(fontStyle: FontStyle.italic),
                          )
                        ],
                      ),
                    ],
                  ),
                  SizedBox(height: 10),
                  Center(
                    child: Text(
                      '\nThe brains behind the art\n',
                      style:
                          TextStyle(fontStyle: FontStyle.italic, fontSize: 20),
                    ),
                  ),
                  SizedBox(height: 10),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceAround,
                    children: [
                      Founder(
                        founder: 'Rohan Sharma',
                        onPressed: () => launchUrl(Uri.parse(
                            'https://www.linkedin.com/in/rohan-sharma-529121198')),
                        imageUrl: 'assets/rohan.jpg',
                      ),
                      Founder(
                        founder: 'Milind Raj',
                        onPressed: () => launchUrl(Uri.parse(
                            'https://www.linkedin.com/in/milind-raj-a452991a5')),
                        imageUrl: 'assets/milind.jpg',
                      )
                    ],
                  ),
                ],
              ),
            ),
          ),
        ));
  }
}

class Founder extends StatelessWidget {
  const Founder({
    required this.founder,
    required this.imageUrl,
    required this.onPressed,
  });
  final String imageUrl;
  final String founder;
  final VoidCallback onPressed;
  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        CircleAvatar(
          radius: 60,
          child: Image.asset(imageUrl),
        ),
        SizedBox(
          height: 15,
        ),
        Text(
          founder,
          style: Theme.of(context).textTheme.titleLarge,
        ),
        SizedBox(
          height: 15,
        ),
        InkWell(
          onTap: onPressed,
          child: Container(
            height: 20,
            width: 20,
            child: Image.asset('assets/linkedin.png'),
          ),
        )
      ],
    );
  }
}
