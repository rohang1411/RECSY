import 'package:flutter/material.dart' hide CarouselController;
import 'package:mobile_recommender/utils/helpers.dart';
import 'package:mobile_recommender/export.dart';
import 'package:carousel_slider/carousel_slider.dart';
import 'package:mobile_recommender/screen/mobile_desc.dart';

class BannerList extends StatefulWidget {
  @override
  _BannerListState createState() => _BannerListState();
}

class _BannerListState extends State<BannerList> {
  int currentPage = 0;

  final CarouselSliderController _controller = CarouselSliderController();

  @override
  Widget build(BuildContext context) {
    List<Mobile> mobileBanner = Provider.of<FilterPage>(context).banners;
    return Container(
      height: 285,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Text(
            'Buy The Best',
            textAlign: TextAlign.left,
            style: Theme.of(context)
                .textTheme
                .bodyLarge
                ?.copyWith(fontSize: 20, fontFamily: 'Segoe UI'),
          ),
          Expanded(
            child: CarouselSlider.builder(
              carouselController: _controller,
              itemCount: mobileBanner.length,
              itemBuilder: (context, index, realIndex) {
                final mobile = mobileBanner[index];
                return InkWell(
                  onTap: () {
                    Navigator.of(context).pushNamed(MobilePage.Route, arguments: mobile);
                  },
                  child: Card(
                    elevation: 4.0,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(15.0),
                    ),
                    color: mobile.color.withAlpha(230),
                    child: Padding(
                      padding: const EdgeInsets.all(16.0),
                      child: Row(
                        children: [
                          Expanded(
                            flex: 2,
                            child: Image.network(
                              getFirebaseImageUrl(mobile.imageUrl),
                              fit: BoxFit.contain,
                            ),
                          ),
                          const SizedBox(width: 16),
                          Expanded(
                            flex: 3,
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Buy The Best',
                                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                                        color: Colors.white70,
                                      ),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  mobile.name,
                                  style: Theme.of(context).textTheme.titleLarge?.copyWith(
                                        color: Colors.white,
                                        fontWeight: FontWeight.bold,
                                      ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                );
              },
              options: CarouselOptions(
                height: 200,
                autoPlay: true,
                enlargeCenterPage: true,
                aspectRatio: 16 / 9,
                autoPlayCurve: Curves.fastOutSlowIn,
                enableInfiniteScroll: true,
                autoPlayAnimationDuration: const Duration(milliseconds: 800),
                viewportFraction: 0.8,
                onPageChanged: (index, reason) {
                  setState(() {
                    currentPage = index;
                  });
                },
              ),
            ),
          ),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              for (var i = 0; i < mobileBanner.length; i++)
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    CircleAvatar(
                      radius: 6,
                      backgroundColor: currentPage == i
                          ? Theme.of(context).primaryColor
                          : Theme.of(context).colorScheme.secondary,
                    ),
                    SizedBox(
                      width: 5,
                    ),
                  ],
                ),
            ],
          ),
        ],
      ),
    );
  }
}
