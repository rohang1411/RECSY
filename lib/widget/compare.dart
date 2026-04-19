import 'package:flutter/material.dart';
import 'package:mobile_recommender/export.dart';
import 'package:mobile_recommender/utils/helpers.dart';

class CompareWidget extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final _card = Provider.of<FilterPage>(context).comparePhone;
    return Card(
      elevation: 4.0,
      margin: const EdgeInsets.all(8.0),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(15.0),
      ),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 16.0, horizontal: 8.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(left: 8.0, bottom: 12.0),
              child: Text(
                'Compare Phones',
                style: Theme.of(context)
                    .textTheme
                    .titleLarge
                    ?.copyWith(fontWeight: FontWeight.bold),
              ),
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildPhoneSelector(context, _card, 0),
                const SizedBox(width: 8),
                Chip(
                  label: Text('VS',
                      style:
                          TextStyle(fontWeight: FontWeight.bold, color: Colors.white)),
                  backgroundColor: Theme.of(context).primaryColor,
                ),
                const SizedBox(width: 8),
                _buildPhoneSelector(context, _card, 1),
              ],
            ),
            const SizedBox(height: 16),
            Center(
              child: ElevatedButton.icon(
                onPressed: () {
                  if (_card.length == 2) {
                    Navigator.of(context)
                        .pushNamed(CompareScreen.Route, arguments: {'mobiles': _card});
                  }
                },
                icon: Icon(Icons.compare_arrows),
                label: Text('Compare Now'),
                style: ElevatedButton.styleFrom(
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(20.0),
                  ),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 30, vertical: 12),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPhoneSelector(
      BuildContext context, List<Mobile> selectedMobiles, int index) {
    final mobile = index < selectedMobiles.length ? selectedMobiles[index] : null;

    return Expanded(
      child: InkWell(
        onTap: () {
          Navigator.of(context).pushNamed(SearchPage.Route, arguments: {
            'mobiles': selectedMobiles,
            'selected': index,
            'compare': false,
          });
        },
        child: Card(
          elevation: 2.0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10.0),
          ),
          child: Container(
            height: 120,
            padding: const EdgeInsets.all(8.0),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (mobile != null)
                  Expanded(
                    child: Image.network(
                      getFirebaseImageUrl(mobile.imageUrl),
                      fit: BoxFit.contain,
                    ),
                  )
                else
                  Icon(Icons.add_circle_outline, size: 40, color: Colors.grey),
                const SizedBox(height: 8),
                Text(
                  mobile?.name ?? 'Select Phone',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontWeight: FontWeight.bold),
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
