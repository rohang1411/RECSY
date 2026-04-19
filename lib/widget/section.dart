import 'package:flutter/material.dart';
import 'package:mobile_recommender/export.dart';
import 'package:mobile_recommender/utils/helpers.dart';
import 'package:mobile_recommender/screen/mobile_desc.dart';

class SectionItem extends StatelessWidget {
  final String title;
  final List<Mobile> list;
  final bool displayText;

  SectionItem({required this.title, required this.list, required this.displayText});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 220, // Increased height to accommodate new card design
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10.0),
            child: Text(
              title,
              style: Theme.of(context)
                  .textTheme
                  .titleLarge
                  ?.copyWith(fontWeight: FontWeight.bold),
            ),
          ),
          SizedBox(height: 8),
          Expanded(
            child: ListView.builder(
              scrollDirection: Axis.horizontal,
              itemCount: list.length,
              itemBuilder: (context, index) {
                return Padding(
                  padding: EdgeInsets.only(
                    left: index == 0 ? 10.0 : 0.0,
                    right: 10.0,
                  ),
                  child: SingleSectionItem(
                    item: list[index],
                    displayText: displayText,
                  ),
                );
              },
            ),
          )
        ],
      ),
    );
  }
}

class SingleSectionItem extends StatelessWidget {
  const SingleSectionItem({
    required this.item,
    required this.displayText,
    this.width = 140,
    this.height = 160, // Add height back with a default
  });

  final Mobile item;
  final bool displayText;
  final double width;
  final double height;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: displayText
          ? () {
              Navigator.of(context).pushNamed(MobilePage.Route, arguments: item);
            }
          : () {},
      borderRadius: BorderRadius.circular(15),
      child: Container(
        width: width,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Container(
              height: height,
              width: width,
              child: Card(
                elevation: 4,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(15),
                ),
                clipBehavior: Clip.antiAlias,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    Container(color: item.color.withAlpha(204)),
                    Padding(
                      padding: const EdgeInsets.all(8.0),
                      child: Image.network(
                        getFirebaseImageUrl(item.imageUrl),
                        fit: BoxFit.contain,
                        errorBuilder: (context, error, stackTrace) =>
                            const Icon(Icons.error, color: Colors.white),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            if (displayText)
              const SizedBox(height: 8),
            if (displayText)
              Flexible(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8.0),
                  child: Text(
                    item.name,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                    textAlign: TextAlign.center,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
