import 'package:flutter/material.dart';
import 'package:mobile_recommender/export.dart';

class AllPhonesScreen extends StatefulWidget {
  static const Route = '/all_phones';

  const AllPhonesScreen({Key? key}) : super(key: key);

  @override
  _AllPhonesScreenState createState() => _AllPhonesScreenState();
}

class _AllPhonesScreenState extends State<AllPhonesScreen> {
  List<Mobile> _filteredMobiles = [];
  final TextEditingController _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _filteredMobiles = mobiles;
    _searchController.addListener(() {
      _filterMobiles();
    });
  }

  void _filterMobiles() {
    final query = _searchController.text.toLowerCase();
    setState(() {
      _filteredMobiles = mobiles
          .where((mobile) => mobile.name.toLowerCase().contains(query))
          .toList();
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Select a Phone'),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(8.0),
            child: TextField(
              controller: _searchController,
              decoration: InputDecoration(
                labelText: 'Search by name',
                prefixIcon: Icon(Icons.search),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10.0),
                ),
              ),
            ),
          ),
          Expanded(
            child: ListView.builder(
              itemCount: _filteredMobiles.length,
              itemBuilder: (context, index) {
                final mobile = _filteredMobiles[index];
                return ListTile(
                  leading: Image.network(
                    mobile.imageUrl,
                    width: 50,
                    height: 50,
                    fit: BoxFit.cover,
                    errorBuilder: (c, o, s) => Icon(Icons.error),
                  ),
                  title: Text(mobile.name),
                  onTap: () {
                    Navigator.of(context).pop(mobile);
                  },
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
