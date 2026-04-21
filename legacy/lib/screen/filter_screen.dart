

import 'package:flutter/material.dart';
import 'package:mobile_recommender/export.dart';

class FilterScreen extends StatefulWidget {
  static const String Route = '/filter';

  @override
  _FilterScreenState createState() => _FilterScreenState();
}

class _FilterScreenState extends State<FilterScreen> {
  List<String> title = <String>[];
  List<String> post = <String>[];
  List<String> link = <String>[];

  @override
  Widget build(BuildContext context) {
    final filterPage = Provider.of<FilterPage>(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Filter Results'),
      ),
      body: GridView.builder(
        itemCount: filterPage.filterListResult.length,
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 2,
          childAspectRatio: 8.0 / 12.0,
        ),
        itemBuilder: (BuildContext context, int index) {
          return Padding(
            padding: const EdgeInsets.all(5),
                        child: SingleSectionItem(
                            item: filterPage.filterListResult[index],
              displayText: true,
            ),
          );
        },
      ),
    );
  }
}
