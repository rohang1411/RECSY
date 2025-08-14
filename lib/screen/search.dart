import 'package:flutter/material.dart';
import 'package:mobile_recommender/export.dart';

class SearchPage extends StatefulWidget {
  static const Route = '/search';

  @override
  _SearchPageState createState() => _SearchPageState();
}

class _SearchPageState extends State<SearchPage> {
  TextEditingController search = TextEditingController();
  String _compare = '';
  int _selected = 0;
  bool init = true;
  int _index = 0;
  bool _select;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final Map args = ModalRoute.of(context).settings.arguments;
    if (init) {
      _index = args['selected'];
      _select = args['compare'];
      init = false;
    }
    _selected = _index;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        toolbarHeight: 70,
        backgroundColor: kPrimaryColor,
        actions: [
          IconButton(
            icon: Icon(Icons.close),
            onPressed: () {
              Navigator.of(context).pop();
            },
          ),
        ],
        automaticallyImplyLeading: false,
        leading: Icon(Icons.search),
        title: TextField(
          onChanged: (val) {
            setState(() {
              _compare = val;
            });
          },
          controller: search,
          decoration: InputDecoration(
            labelText: 'Search',
          ),
        ),
      ),
      body: SafeArea(
        child: ListView.builder(
            itemCount: mobiles.length + 1,
            itemBuilder: (context, int index) {
              if (index == 0) {
                return Container(
                  margin: EdgeInsets.all(10),
                  child: Text(
                    'Select ${_selected + 1 == 1 ? 'First' : 'Second'} Phone',
                    style: bodyText(context),
                  ),
                );
              } else {
                if (mobiles[index - 1].name.toLowerCase().contains(_compare)) {
                  return ListTile(
                    onTap: () {
                      Provider.of<FilterPage>(context, listen: false)
                          .randomCompare(_selected, mobiles[index - 1]);
                      if (_select && _selected != 2) {
                        setState(() {
                          _selected++;
                        });
                      } else if (!_select) Navigator.of(context).pop();
                      if (_selected == 2)
                        Navigator.of(context).pushReplacementNamed(
                            CompareScreen.Route,
                            arguments: {
                              'mobiles': Provider.of<FilterPage>(context,
                                      listen: false)
                                  .comparePhone
                            });
                    },
                    title: Text(
                      mobiles[index - 1].name,
                      style: TextStyle(
                        fontSize: 20,
                      ),
                    ),
                  );
                } else {
                  return Container();
                }
              }
            }),
      ),
    );
  }
}
