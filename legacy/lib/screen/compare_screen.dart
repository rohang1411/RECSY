import 'package:flutter/material.dart';
import 'package:mobile_recommender/export.dart';
import 'package:mobile_recommender/screen/all_phones_screen.dart';

class CompareScreen extends StatefulWidget {
  static const Route = '/compare';

  const CompareScreen({Key? key}) : super(key: key);

  @override
  _CompareScreenState createState() => _CompareScreenState();
}

class _CompareScreenState extends State<CompareScreen> {
  List<Mobile> _mobiles = [];

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final Map? args = ModalRoute.of(context)?.settings.arguments as Map?;
    if (args != null && args['mobiles'] != null) {
      _mobiles = List<Mobile>.from(args['mobiles']);
    }
  }

  @override
  Widget build(BuildContext context) {
    final List<String> keys = _mobiles.isNotEmpty ? _mobiles[0].specs.keys.toList() : [];

    return Scaffold(
      body: CustomScrollView(
        slivers: [
          SliverAppBar(
            title: const Text('Comparison'),
            floating: true,
            pinned: true,
            elevation: 0,
            backgroundColor: Theme.of(context).scaffoldBackgroundColor,
          ),
          SliverToBoxAdapter(
            child: _buildHeader(context),
          ),
          if (_mobiles.length == 2)
            SliverList(
              delegate: SliverChildBuilderDelegate(
                (context, index) {
                  final key = keys[index];
                  return _buildComparisonRow(context, key, _mobiles[0], _mobiles[1]);
                },
                childCount: keys.length,
              ),
            )
          else
            SliverFillRemaining(
              child: Center(
                child: Text('Select a second phone to start comparison.'),
              ),
            )
        ],
      ),
    );
  }

  Widget _buildHeader(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _buildPhoneHeader(context, 0),
          _buildPhoneHeader(context, 1),
        ],
      ),
    );
  }

  Widget _buildPhoneHeader(BuildContext context, int index) {
    final mobile = index < _mobiles.length ? _mobiles[index] : null;

    return Expanded(
      child: InkWell(
        onTap: () async {
          final selectedMobile = await Navigator.of(context).pushNamed(AllPhonesScreen.Route);
          if (selectedMobile is Mobile) {
            setState(() {
              if (index < _mobiles.length) {
                _mobiles[index] = selectedMobile;
              } else {
                _mobiles.add(selectedMobile);
              }
            });
          }
        },
        child: Column(
          children: [
            SizedBox(
              height: 120,
              child: mobile != null
                  ? SingleSectionItem(item: mobile, displayText: false)
                  : Icon(Icons.add_circle_outline, size: 40, color: Colors.grey),
            ),
            const SizedBox(height: 8),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8.0),
              child: Text(
                mobile?.name ?? 'Select Phone',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildComparisonRow(BuildContext context, String feature, Mobile mobile1, Mobile mobile2) {
    final spec1 = mobile1.specs[feature]?.toString() ?? '-';
    final spec2 = mobile2.specs[feature]?.toString() ?? '-';

    // Simple numeric comparison for highlighting winner
    double? value1 = double.tryParse(spec1.replaceAll(RegExp(r'[^0-9.]'), ''));
    double? value2 = double.tryParse(spec2.replaceAll(RegExp(r'[^0-9.]'), ''));

    bool mobile1IsWinner = false;
    bool mobile2IsWinner = false;

    if (value1 != null && value2 != null) {
      if (value1 > value2) mobile1IsWinner = true;
      if (value2 > value1) mobile2IsWinner = true;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 12.0),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: Theme.of(context).dividerColor, width: 0.5)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            feature,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              _buildSpecCell(context, spec1, mobile1IsWinner),
              _buildSpecCell(context, spec2, mobile2IsWinner),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildSpecCell(BuildContext context, String spec, bool isWinner) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(8.0),
        decoration: BoxDecoration(
          color: isWinner ? Theme.of(context).colorScheme.primary.withAlpha(26) : Colors.transparent,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(
          spec,
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                fontWeight: isWinner ? FontWeight.bold : FontWeight.normal,
                color: isWinner ? Theme.of(context).colorScheme.primary : null,
              ),
        ),
      ),
    );
  }
}
