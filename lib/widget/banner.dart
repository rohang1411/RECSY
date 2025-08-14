import 'package:flutter/material.dart';
import 'package:mobile_recommender/export.dart';
import 'package:carousel_slider/carousel_slider.dart';
import 'package:mobile_recommender/screen/mobile_desc.dart';

class BannerList extends StatefulWidget {
  @override
  _BannerListState createState() => _BannerListState();
}

class _BannerListState extends State<BannerList> {
  int currentPage = 0;

  CarouselController _controller = CarouselController();
  bool init = true;

  @override
  Widget build(BuildContext context) {
    List<FilterPage> mobileBanner = Provider.of<FilterPage>(context).banners;
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
                .bodyText1
                .copyWith(fontSize: 20, fontFamily: 'Segoe UI'),
          ),
          Expanded(
            child: CarouselSlider(
              carouselController: _controller,
              options: CarouselOptions(
                  enlargeCenterPage: true,
                  initialPage: 0,
                  autoPlay: true,
                  autoPlayCurve: Curves.fastOutSlowIn,
                  pageSnapping: true,
                  onPageChanged: (int value, option) {
                    setState(() {
                      currentPage = value;
                    });
                  }),
              items: List.generate(
                mobileBanner.length,
                (index) => InkWell(
                  onTap: () {
                    Navigator.of(context).pushNamed(MobilePage.Route,
                        arguments: mobileBanner[index]);
                  },
                  child: Container(
                    padding: const EdgeInsets.all(10.0),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceAround,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Expanded(
                            // flex: 2,
                            child: Image.network(mobileBanner[index].imageUrl)),
                        Expanded(
                          // flex: 1,
                          child: RichText(
                            text: TextSpan(
                              style: TextStyle(color: Colors.white),
                              children: [
                                TextSpan(text: 'Buy The Best\n'),
                                TextSpan(
                                  text: mobileBanner[index].name,
                                  style: TextStyle(
                                    fontWeight: FontWeight.bold,
                                    fontSize: 25,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(20),
                      color: mobileBanner[index].color,
                    ),
                    margin: const EdgeInsets.symmetric(vertical: 10),
                  ),
                ),
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
                          : Theme.of(context).accentColor,
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
