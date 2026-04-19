import 'package:flutter/material.dart';
import 'package:mobile_recommender/export.dart';
import 'package:mobile_recommender/widget/description_wid.dart';
import 'package:url_launcher/url_launcher.dart';

class MobilePage extends StatelessWidget {
  static const Route = '/mobilePage';

  @override
  Widget build(BuildContext context) {
    final Mobile mobile = ModalRoute.of(context)?.settings.arguments as Mobile;
    final List<String> specKeys = mobile.specs.keys.toList();

    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => launchUrl(Uri.parse(mobile.buyLink)),
        icon: const Icon(Icons.shopping_bag_outlined),
        label: const Text('Buy Now'),
      ),
      floatingActionButtonLocation: FloatingActionButtonLocation.centerFloat,
      body: CustomScrollView(
        slivers: [
          _buildSliverAppBar(mobile),
          SliverToBoxAdapter(
            child: Container(
              padding: const EdgeInsets.all(16.0),
              child: DescriptionButton(mobile: mobile),
            ),
          ),
          SliverToBoxAdapter(
            child: _buildKeySpecHighlights(context, mobile),
          ),
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 24, 16, 8),
              child: Text(
                'Specifications',
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
              ),
            ),
          ),
          _buildSpecsList(specKeys, mobile),
          const SliverToBoxAdapter(
            child: SizedBox(height: 80), // Space for the FAB
          ),
        ],
      ),
    );
  }

  Widget _buildSliverAppBar(Mobile mobile) {
    return SliverAppBar(
      expandedHeight: 300.0,
      pinned: true,
      floating: false,
      stretch: true,
      backgroundColor: mobile.color.withAlpha(51),
      flexibleSpace: FlexibleSpaceBar(
        centerTitle: true,
        title: Text(
          mobile.name,
          style: const TextStyle(
            fontSize: 18.0,
            fontWeight: FontWeight.bold,
          ),
        ),
        background: Padding(
          padding: const EdgeInsets.all(40.0),
          child: SingleSectionItem(
            item: mobile,
            displayText: false,
          ),
        ),
      ),
    );
  }

  Widget _buildKeySpecHighlights(BuildContext context, Mobile mobile) {
    final List<String> highlightKeys = description.keys.toList().take(4).toList();

    return Container(
      height: 100,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: highlightKeys.length,
        itemBuilder: (context, index) {
          final key = highlightKeys[index];
          final iconPath = description[key]!;
          return _buildHighlightChip(key, mobile.specs[key]?.toString() ?? '-', iconPath);
        },
        separatorBuilder: (context, index) => const SizedBox(width: 12),
      ),
    );
  }

  Widget _buildHighlightChip(String key, String value, String iconPath) {
    return Chip(
      avatar: Image.asset(
        iconPath,
        height: 24,
        width: 24,
        color: kPrimaryColor,
      ),
      label: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(key, style: const TextStyle(fontWeight: FontWeight.bold)),
          Text(value),
        ],
      ),
      padding: const EdgeInsets.all(12),
      backgroundColor: Colors.white.withAlpha(26),
    );
  }

  Widget _buildSpecsList(List<String> keys, Mobile mobile) {
    return SliverList(
      delegate: SliverChildBuilderDelegate(
        (BuildContext context, int index) {
          final key = keys[index];
          final value = mobile.specs[key]?.toString() ?? '-';
          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 4.0),
            child: Card(
              elevation: 0,
              color: Colors.white.withAlpha(13),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(10),
              ),
              child: ListTile(
                title: Text(key, style: const TextStyle(fontWeight: FontWeight.bold)),
                subtitle: Text(value),
              ),
            ),
          );
        },
        childCount: keys.length,
      ),
    );
  }
}
