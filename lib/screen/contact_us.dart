import 'package:flutter/material.dart';
import 'package:mobile_recommender/export.dart';
import 'package:mailer/mailer.dart';
import 'package:mailer/smtp_server.dart';
import 'package:mailer2/mailer.dart';

class ContactUs extends StatefulWidget {
  static const Route = '/contactUs';

  @override
  _ContactUsState createState() => _ContactUsState();
}

class _ContactUsState extends State<ContactUs> {
  bool _message = false;
  final _nameController = TextEditingController();
  final _messageController = TextEditingController();
  final _emailController = TextEditingController();
  void emailsender() async {
    var options = new GmailSmtpOptions()
      ..username = 'spiraldev1415@gmail.com'
      ..password =
          'Recsy@123'; // Note: if you have Google's "app specific passwords" enabled,
    // you need to use one of those here.

    // How you use and store passwords is up to you. Beware of storing passwords in plain.

    // Create our email transport.
    var emailTransport = new SmtpTransport(options);

    // Create our mail/envelope.
    var envelope = new Envelope()
      ..from = 'spiraldev1415@gmail.com'
      ..recipients.add('spiraldev1415@gmail.com')
      ..ccRecipients.addAll(['milindraj003@gmail.com', 'rohang1411@gmail.com'])
      ..subject = 'Recsy Contact Us Message'
      ..text = ' This is a cool email message. Whats up?'
      ..html = '<h1>' +
          _nameController.text +
          ' sent a Message !</h1><br>' +
          'Hi! my email id is ' +
          _emailController.text +
          '<br><br>' +
          _messageController.text;

    // Email it.
    print('hi AU');
    emailTransport
        .send(envelope)
        .then((envelope) => print('Email sent!'))
        .catchError((e) => print('Error occurred: $e'));
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.of(context).size;
    return Scaffold(
      appBar: AppBar(
        title: Text(
          'Contact Us',
          style: bodyText(context),
        ),
      ),
      body: Container(
        alignment: Alignment.center,
        child: SingleChildScrollView(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              AnimatedContainer(
                duration: Duration(milliseconds: 300),
                padding: EdgeInsets.all(30),
                child: !_message
                    ? Column(
                        mainAxisAlignment: MainAxisAlignment.spaceAround,
                        children: [
                          TextField(
                            controller: _nameController,
                            onChanged: (val) {
                              // print(val);
                            },
                            decoration: InputDecoration(
                              labelText: 'Name',
                              border: UnderlineInputBorder(),
                            ),
                          ),
                          TextField(
                            controller: _emailController,
                            onChanged: (val) {
                              // print(val);
                            },
                            decoration: InputDecoration(
                              labelText: 'Email',
                              border: UnderlineInputBorder(),
                            ),
                          ),
                          TextField(
                            controller: _messageController,
                            maxLines: 5,
                            decoration: InputDecoration(
                              alignLabelWithHint: true,
                              labelText: 'Any Message For Us.',
                              border: OutlineInputBorder(
                                borderSide: BorderSide(width: 2),
                              ),
                            ),
                          ),
                          RaisedButton.icon(
                            padding: EdgeInsets.symmetric(
                                horizontal: 25, vertical: 10),
                            icon: Icon(Icons.message),
                            onPressed: () {
                              emailsender();
                              setState(() {
                                _message = true;
                              });
                            },
                            label: Text('Send Message'),
                          )
                        ],
                      )
                    : LimitedBox(
                        child: RichText(
                          text: TextSpan(
                            children: [
                              TextSpan(
                                text: 'Thank\nYou!\n',
                                style: Theme.of(context)
                                    .textTheme
                                    .headline1
                                    .copyWith(
                                        fontSize: 70, color: Colors.white),
                              ),
                              TextSpan(
                                  text: '\nWe\'ll Contact you soon!',
                                  style: Theme.of(context).textTheme.headline4)
                            ],
                          ),
                        ),
                      ),
                height: size.height * 0.5,
                width: size.width * 0.8,
                decoration: BoxDecoration(
                  color: !_message ? kBackContainer : kPrimaryColor,
                  borderRadius: BorderRadius.circular(30),
                ),
              ),
              SizedBox(height: 10),
              Text(
                'Or\nEmail us at',
                textAlign: TextAlign.center,
              ),
              FlatButton.icon(
                onPressed: () {},
                icon: Icon(Icons.email_rounded),
                label: Text(
                  'spiraldev1415@gmail.com',
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
