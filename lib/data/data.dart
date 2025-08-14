import 'dart:convert';

import 'package:mobile_recommender/models/model.dart';
import 'package:flutter/material.dart';
import 'package:mobile_recommender/screen/filter.dart';
import 'package:shared_preferences/shared_preferences.dart';

List<FilterPage> mobiles = [
  FilterPage(
      id: '0',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1KbPqrQ6r38xCnBpP74wyS_Be0F3jVUaf',
      buyLink:
          'https://www.flipkart.com/redmi-k20-pro-carbon-black-128-gb/p/itmfgfjtdjkzgyyr?pid=MOBFG7UYMCBRSQZ8&lid=LSTMOBFG7UYMCBRSQZ8VPP2VS&marketplace=FLIPKART&srno=s_1_2&otracker=AS_QueryStore_OrganicAutoSuggest_1_9_na_na_ps&otracker1=AS_QueryStore_OrganicAutoSuggest_1_9_na_na_ps&fm=SEARCH&iid=1b0c12f0-744a-48ee-89c4-76bdec546892.MOBFG7UYMCBRSQZ8.SEARCH&ppt=sp&ppn=sp&ssid=gvll6278ow0000001599477064996&qH=0b2f308098dbede3',
      color: Colors.red[400],
      name: 'Redmi K20 pro',
      specs: {
        'Cameras': '48 MP',
        'Front Camera': 'Motorized pop-up 20 MP, f/2.2, (wide), 1/3.4", 0.8µm',
        'Rear Camera': '48 MP, f/1.8, 26mm (wide), 1/2.0", 0.8µm, PDAF, Laser AF' +
            '\n' +
            '8 MP, f/2.4, 53mm (telephoto), 1/4.0", 1.12µm, PDAF, 2x optical zoom' +
            '\n' +
            '13 MP, f/2.4, 12mm (ultrawide), 1/3.1", 1.12µm',
        'Display': 'Super AMOLED, HDR10',
        'Processor': 'Qualcomm SM8150 Snapdragon 855 (7 nm)',
        'Performance': 'SD 855 ',
        'Ratings': '7/10',
        'Storage': '64GB 6GB RAM, 128GB 6GB RAM, 128GB 8GB RAM, 256GB 8GB RAM',
        'Battery': '4000 mAh',
        'Resolution': '1080 x 2340 pixels, 19.5:9 ratio (~403 ppi density)',
      }),
  FilterPage(
      id: '1',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1X9GA3aAN-WtAFKoYqx9CkgPbAVvmMM_X',
      buyLink:
          'https://www.flipkart.com/redmi-k20-carbon-black-128-gb/p/itmfggktjkrahjwm?pid=MOBFG7UYGCXFUZZV&lid=LSTMOBFG7UYGCXFUZZV3A8OBA&marketplace=FLIPKART&srno=s_1_1&otracker=search&otracker1=search&fm=SEARCH&iid=b289314d-ae04-4624-84f9-61b5a7248b63.MOBFG7UYGCXFUZZV.SEARCH&ppt=sp&ppn=sp&ssid=tl1i8ba8zk0000001599477188783&qH=2ea34f537c554346',
      color: Colors.blue[200],
      name: 'Redmi K20',
      specs: {
        'Cameras': '48 MP',
        'Front Camera': 'Motorized pop-up 20 MP, f/2.2, (wide), 1/3.4", 0.8µm',
        'Rear Camera': '48 MP, f/1.8, 26mm (wide), 1/2.0", 0.8µm, PDAF' +
            '\n' +
            '8 MP, f/2.4, 53mm (telephoto), 1/4.0", 1.12µm, PDAF, 2x optical zoom' +
            '\n' +
            '13 MP, f/2.4, 12mm (ultrawide), 1/3.1", 1.12µm',
        'Display': 'Super AMOLED, HDR',
        'Processor': 'Qualcomm SDM730 Snapdragon 730 (8 nm)',
        'Performance': 'SD 730 ',
        'Ratings': '4/10',
        'Storage': '64GB 6GB RAM, 128GB 6GB RAM, 256GB 8GB RAM',
        'Battery': '4000 mAh',
        'Resolution': '1080 x 2340 pixels, 19.5:9 ratio (~403 ppi density)',
      }),
  FilterPage(
      id: '2',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1HN3zXBMPJqVRjr13cJ0kWEspc_j9jrzg',
      buyLink: 'https://amzn.to/3jTYAEK',
      color: Colors.pink[200],
      name: 'Redmi Note 9 pro',
      specs: {
        'Cameras': '64 MP',
        'Front Camera': '16 MP, f/2.5, (wide), 1/3.06", 1.0µm',
        'Rear Camera': '64 MP, f/1.9, 26mm (wide), 1/1.72", 0.8µm, PDAF' +
            '\n' +
            '8 MP, f/2.2, 119˚ (ultrawide), 1/4.0", 1.12µm' +
            '\n' +
            '5 MP, f/2.4, (macro), AF' +
            '\n' +
            '2 MP, f/2.4, (depth)',
        'Display': 'IPS LCD ',
        'Processor': 'Qualcomm SM7125 Snapdragon 720G (8 nm)',
        'Performance': 'SD 720G',
        'Ratings': '4/10',
        'Storage': '64GB 6GB RAM, 128GB 6GB RAM',
        'Battery': '5020 mAh',
        'Resolution': '1080 x 2400 pixels, 20:9 ratio (~395 ppi density)',
      }),
  FilterPage(
      id: '3',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=15NTAGYNvw6SGFXhTz17wRYU-1Va5EjMu',
      buyLink: 'https://amzn.to/3oA5mCP',
      color: Colors.cyan[400],
      name: 'Redmi 9A',
      specs: {
        'Cameras': '13 MP',
        'Front Camera': '5 MP, f/2.2, (wide), 1.12µm',
        'Rear Camera': '13 MP, f/2.2, 28mm (wide), 1.0µm, PDAF',
        'Display': 'IPS LCD, 400 nits (typ)',
        'Processor': 'MediaTek Helio G25 (12 nm)',
        'Performance': 'MT G25',
        'Ratings': '2/10',
        'Storage': '32GB 2GB RAM, 32GB 3GB RAM, 128GB 6GB RAM',
        'Battery': '5000 mAh',
        'Resolution': '720 x 1600 pixels, 20:9 ratio (~269 ppi density)'
      }),
  FilterPage(
      id: '4',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1MfSP0Kt0qaLGBosfFp4PSEW9qN88zPuw',
      buyLink: 'https://amzn.to/359ByFH',
      color: Colors.blue[300],
      name: 'Redmi 8a',
      specs: {
        'Cameras': '12 MP',
        'Front Camera': '8 MP, f/2.0, 1/4", 1.12µm',
        'Rear Camera': '12 MP, f/1.8, (wide), 1/2.55", 1.4µm, dual pixel PDAF',
        'Display': 'IPS LCD, 400 nits (typ)',
        'Processor': 'Qualcomm SDM439 Snapdragon 439 (12 nm)',
        'Performance': 'SD 439 ',
        'Ratings': '2/10',
        'Storage': '32GB 2GB RAM, 32GB 3GB RAM, 64GB 4GB RAM',
        'Battery': '5000 mAh',
        'Resolution': '720 x 1520 pixels, 19:9 ratio (~270 ppi density)',
      }),
  FilterPage(
      id: '5',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1XHA-35XNzp0_GTAs0_Ob--TXWKDSnh-a',
      buyLink:
          'https://www.flipkart.com/redmi-9i-midnight-black-64-gb/p/itm15c585b87d780',
      color: Colors.blue[400],
      name: 'Redmi 9i',
      specs: {
        'Cameras': ' 13 MP',
        'Front Camera': ' 5 MP, f/2.2, (wide), 1.12µm',
        'Rear Camera': ' 13 MP, f/2.2, 28mm (wide), 1.0µm, PDAF',
        'Display': 'IPS LCD, 270 nits (typ)',
        'Processor': 'MediaTek Helio G25 (12 nm)',
        'Performance': 'MT G25',
        'Ratings': '2/10',
        'Storage': '64GB 4GB RAM, 128GB 4GB RAM',
        'Battery': '5000 mAh',
        'Resolution': '720 x 1600 pixels, 20:9 ratio (~269 ppi density)'
      }),
  FilterPage(
      id: '6',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1zFtZDFlBm8NMPpQxNaYpmuGlV_gFNmMK',
      buyLink: 'https://amzn.to/2EWnPaH',
      color: Colors.green[300],
      name: 'Redmi 9 Prime',
      specs: {
        'Cameras': '13 MP',
        'Front Camera': '8 MP, f/2.0, 27mm (wide), 1/4.0", 1.12µm',
        'Rear Camera': '13 MP, f/2.2, 28mm (wide), 1/3.1", 1.12µm, PDAF' +
            '\n' +
            '8 MP, f/2.2, 118˚ (ultrawide), 1/4.0", 1.12µm' +
            '\n' +
            '5 MP, f/2.4, (macro)' +
            '\n' +
            '2 MP, f/2.4, (depth)',
        'Display': 'IPS LCD, 400 nits (typ)',
        'Processor': 'Mediatek Helio G80 (12 nm)',
        'Performance': 'MT G80',
        'Ratings': '4/10',
        'Storage': '64GB 4GB RAM, 128GB 4GB RAM',
        'Battery': '5020 mAh',
        'Resolution': '1080 x 2340 pixels, 19.5:9 ratio (~395 ppi density)',
      }),
  FilterPage(
      id: '7',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1cFiuD97hPcbsoZx8ePqeA2Bz3FFG3s-C',
      buyLink: 'https://amzn.to/323Dbmo',
      color: Colors.red[300],
      name: 'Redmi Note 9',
      specs: {
        'Cameras': '48 MP',
        'Front Camera': '13 MP, f/2.3, 29mm (standard), 1/3.1", 1.12µm',
        'Rear Camera': '48 MP, f/1.8, 26mm (wide), 1/2.0", 0.8µm, PDAF' +
            '\n' +
            '8 MP, f/2.2, 118˚ (ultrawide), 1/4.0", 1.12µm' +
            '\n' +
            '2 MP, f/2.4, (macro), AF' +
            '\n' +
            '2 MP, f/2.4, (depth)',
        'Display': 'IPS LCD, 450 nits (typ)',
        'Processor': 'MediaTek Helio G85 (12nm)',
        'Performance': 'MT G85 ',
        'Ratings': '6/10',
        'Storage': '64GB 3GB RAM, 64GB 4GB RAM, 128GB 4GB RAM',
        'Battery': '5020 mAh',
        'Resolution': '1080 x 2340 pixels, 19.5:9 ratio (~395 ppi density)',
      }),
  FilterPage(
      id: '8',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1WsJzRxZdBrzKjm76hUeEJJah5pIrLQ3b',
      buyLink: 'https://amzn.to/3lWsM3K',
      color: Colors.orange[400],
      name: 'Redmi Note 9 pro max',
      specs: {
        'Cameras': '64 MP',
        'Front Camera': '32 MP, (wide), 1/2.8", 0.8µm',
        'Rear Camera': '64 MP, f/1.9, 26mm (wide), 1/1.72", 0.8µm, PDAF' +
            '\n' +
            '8 MP, f/2.2, 13mm (ultrawide), 1/4.0", 1.12µm' +
            '\n' +
            '5 MP, f/2.4, (macro)' +
            '\n' +
            '2 MP, f/2.4, (depth)',
        'Display': 'IPS LCD, 450 nits (typ)',
        'Processor': 'Qualcomm SM7125 Snapdragon 720G (8 nm)',
        'Performance': 'SD 720G',
        'Ratings': '6/10',
        'Storage': '64GB 6GB RAM, 128GB 6GB RAM, 128GB 8GB RAM',
        'Battery': '5020 mAh',
        'Resolution': '1080 x 2400 pixels, 20:9 ratio (~395 ppi density)',
      }),
  FilterPage(
      id: '9',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1hjDOhGpsijsqTdn8XLy7SnPQhMh8JlN1',
      buyLink:
          'https://www.flipkart.com/oppo-reno4-pro-silky-white-128-gb/p/itm7d439eedcfabf?pid=MOBFU2GY8Z4PWZZ9&lid=LSTMOBFU2GY8Z4PWZZ9X0QXXK&marketplace=FLIPKART&srno=s_1_1&otracker=AS_QueryStore_OrganicAutoSuggest_2_10_na_na_ps&otracker1=AS_QueryStore_OrganicAutoSuggest_2_10_na_na_ps&fm=SEARCH&iid=a8316597-b2bf-40ea-9221-a010a22dd2fc.MOBFU2GY8Z4PWZZ9.SEARCH&ppt=sp&ppn=sp&ssid=zjr6q17v000000001599477751092&qH=d1c5df2cea3c2ca6',
      color: Colors.cyan[400],
      name: 'Oppo Reno 4 Pro',
      specs: {
        'Cameras': '48 MP',
        'Front Camera': '32 MP, f/2.4, 26mm (wide), 1/2.8", 0.8µm',
        'Rear Camera': '48 MP, f/1.7, 26mm (wide), 1/2.0", 0.8µm, PDAF' +
            '\n' +
            '8 MP, f/2.2, 119˚ (ultrawide), 1/4.0", 1.12µm' +
            '\n' +
            '2 MP, f/2.4, (macro)' +
            '\n' +
            '2 MP, f/2.4, (depth)',
        'Display': 'Super AMOLED, 90Hz, HDR10, 500 nits (typ)',
        'Processor': 'Qualcomm SM7125 Snapdragon 720G (8 nm)',
        'Performance': 'SD 720G',
        'Ratings': '7/10',
        'Storage': '128GB 8GB RAM, 256GB 8GB RAM',
        'Battery': '4000 mAh',
        'Resolution': '1080 x 2400 pixels, 20:9 ratio (~402 ppi density)',
      }),
  FilterPage(
      id: '10',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1ve60ydKdsXkU0HV0l23FEJPHwG3ANZ5X',
      buyLink: 'https://amzn.to/3bxz45f',
      color: Colors.purple[400],
      name: 'Oppo Find X2',
      specs: {
        'Cameras': '48 MP',
        'Front Camera': '32 MP, f/2.4, (wide), 1/2.8", 0.8µm',
        'Rear Camera':
            '48 MP, f/1.7, 26mm (wide), 1/2.0", 0.8µm, PDAF, Laser AF, OIS' +
                '\n' +
                '13 MP, f/2.4, 52mm (telephoto), 2x optical zoom, PDAF, OIS' +
                '\n' +
                '12 MP, f/2.2, 16mm (ultrawide), 1/2.4", AF',
        'Display': 'AMOLED, 1B colors, 120Hz, HDR10+, 800 nits (typ)',
        'Processor': 'Qualcomm SM8250 Snapdragon 865 (7 nm+)',
        'Performance': 'SD 865 ',
        'Ratings': '9/10',
        'Storage': '128GB 8GB RAM, 256GB 8GB RAM, 256GB 12GB RAM',
        'Battery': '4200 mAh',
        'Resolution': '1440 x 3168 pixels (~513 ppi density)',
      }),
  FilterPage(
      id: '11',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1s0O2699Vmqo76EQr9UuyZ0ANI-jC3J3a',
      buyLink:
          'https://www.flipkart.com/oppo-reno2-f-sky-white-256-gb/p/itm8413e7eb0b195?pid=MOBFTX93JK4UGWZS&lid=LSTMOBFTX93JK4UGWZSSPNQBC&marketplace=FLIPKART&srno=s_1_1&otracker=AS_QueryStore_OrganicAutoSuggest_1_7_na_na_ps&otracker1=AS_QueryStore_OrganicAutoSuggest_1_7_na_na_ps&fm=SEARCH&iid=692584a1-deed-4238-822c-eab1ed999591.MOBFTX93JK4UGWZS.SEARCH&ppt=sp&ppn=sp&ssid=a4ddfblmbk0000001599477874144&qH=4c294c619b7db719',
      color: Colors.teal,
      name: 'Oppo Reno 2F',
      specs: {
        'Cameras': '48 MP',
        'Front Camera':
            'Motorized pop-up 16 MP, f/2.0, 26mm (wide), 1/3.06", 1.0µm',
        'Rear Camera': '48 MP, f/1.7, 26mm (wide), 1/2.3", 0.8µm, PDAF' +
            '\n' +
            '8 MP, f/2.2, 13mm (ultrawide), 1/4.0", 1.12µm' +
            '\n' +
            '2 MP B/W, f/2.4, 1/5.0", 1.75µm' +
            '\n' +
            '2 MP, f/2.4, (depth)',
        'Display': 'AMOLED ',
        'Processor': 'Mediatek MT6771V Helio P70 (12nm)',
        'Performance': 'MT P70',
        'Ratings': '4/10',
        'Storage': '128GB 8GB RAM, 256GB 6GB RAM',
        'Battery': '4000 mAh',
        'Resolution': '1080 x 2340 pixels, 19.5:9 ratio (~394 ppi density)',
      }),
  FilterPage(
      id: '12',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=12WBbeKQ6DPjAK-R0YbDsauqZjB84JmQj',
      buyLink:
          'https://www.flipkart.com/realme-7i-fusion-green-64-gb/p/itm13f2c8bee336b?pid=MOBFVH837JMRENEB&lid=LSTMOBFVH837JMRENEBKFTD7A&marketplace=FLIPKART&srno=s_1_1&otracker=search&otracker1=search&fm=SEARCH&iid=9ac5ad94-313b-4ae0-895c-75a86db0fe44.MOBFVH837JMRENEB.SEARCH&ppt=sp&ppn=sp&ssid=6nielwffsw0000001603711150121&qH=7f64ebd5711fd7cb',
      color: Colors.red[300],
      name: 'Realme 7i',
      specs: {
        'Cameras': '64 MP',
        'Front Camera': '16 MP, f/2.1, 26mm (wide), 1/3", 1.0µm',
        'Rear Camera':
            '64 MP, f/1.8, 26mm (wide), 1/1.73", 0.8µm, PDAF\n8 MP, f/2.3, 119˚, 16mm (ultrawide), 1/4.0", 1.12µm\n2 MP, f/2.4, (macro)\n2 MP, f/2.4, (depth)',
        'Display': 'IPS LCD, 90Hz',
        'Processor': 'Qualcomm SM6115 Snapdragon 662 (11 nm)',
        'Performance': 'SD 662',
        'Ratings': '7/10',
        'Storage': '64GB 4GB RAM, 128GB 4GB RAM, 128GB 8GB RAM',
        'Battery': '5000 mAh',
        'Resolution': '720 x 1600 pixels, 20:9 ratio (~270 ppi density)'
      }),
  FilterPage(
      id: '13',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1BSVPH8Q4hz99hh0Finnv5NUlN99rvGeE',
      buyLink:
          'https://www.flipkart.com/realme-narzo-20-pro-black-ninja-64-gb/p/itm043c480bf22fb?pid=MOBFVEATWGRHFRJ9&lid=LSTMOBFVEATWGRHFRJ9KMPDP5&marketplace=FLIPKART&srno=s_1_2&otracker=search&otracker1=search&fm=SEARCH&iid=fd570143-f65a-4564-9d71-cdb71e719723.MOBFVEATWGRHFRJ9.SEARCH&ppt=sp&ppn=sp&ssid=diuaoxaurk0000001603711195684&qH=878fa1b2c417bdbe',
      color: Colors.red[400],
      name: 'Realme Narzo 20 Pro',
      specs: {
        'Cameras': '48 MP',
        'Front Camera': '16 MP, f/2.1, (wide), 1/3", 1.0µm',
        'Rear Camera':
            '48 MP, f/1.8, 26mm (wide), 1/2.0", 0.8µm, PDAF\n8 MP, f/2.3, 119˚ (ultrawide), 1/4.0", 1.12µm\n2 MP, f/2.4, (macro)\n2 MP, f/2.4, (depth)',
        'Display': 'IPS LCD',
        'Processor': 'Mediatek Helio G95 (12 nm)',
        'Performance': 'MT G95',
        'Ratings': '7/10',
        'Storage': '64GB 6GB RAM, 128GB 8GB RAM',
        'Battery': '4500 mAh',
        'Resolution': '1080 x 2400 pixels, 20:9 ratio (~405 ppi density)'
      }),
  FilterPage(
      id: '14',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=12rPvyXm7DbZw1X4lRLnEWLq2mEiZL61Q',
      buyLink:
          'https://www.flipkart.com/realme-narzo-20-victory-blue-128-gb/p/itm4ac58d879006d?pid=MOBFVEATJGZZNHHA&lid=LSTMOBFVEATJGZZNHHABOVSYZ&marketplace=FLIPKART&srno=s_1_3&otracker=search&otracker1=search&fm=SEARCH&iid=95ca01a4-22cc-4811-8cea-bbf60540786f.MOBFVEATJGZZNHHA.SEARCH&ppt=sp&ppn=sp&ssid=jadhxgapeo0000001603711238548&qH=952e4217a6434829',
      color: Colors.orange[400],
      name: 'Realme Narzo 20',
      specs: {
        'Cameras': ' 48 MP',
        'Front Camera': '8 MP',
        'Rear Camera':
            '48 MP, f/1.8, 26mm (wide), 1/2.0", 0.8µm, PDAF\n8 MP, f/2.3, 119˚ (ultrawide), 1/4.0", 1.12µm\n2 MP, f/2.4, (macro)',
        'Display': 'IPS LCD',
        'Processor': 'MediaTek Helio G85 (12nm)',
        'Performance': 'MT G85',
        'Ratings': '6/10',
        'Storage': '64GB 4GB RAM, 128GB 4GB RAM',
        'Battery': '6000 mAh',
        'Resolution': '720 x 1600 pixels, 20:9 ratio (~270 ppi density)',
      }),
  FilterPage(
      id: '15',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1xT2Xgz8GPKEbsVpsP-s8-oYIQixdgPcb',
      buyLink:
          'https://www.flipkart.com/realme-6i-eclipse-black-64-gb/p/itm0201cc97a2f61?pid=MOBFTAYNKMEGWUKJ&lid=LSTMOBFTAYNKMEGWUKJSLPGZG&marketplace=FLIPKART&srno=s_1_2&otracker=AS_Query_OrganicAutoSuggest_6_4_na_na_na&otracker1=AS_Query_OrganicAutoSuggest_6_4_na_na_na&fm=SEARCH&iid=379ea92a-13b4-44fd-bbe7-8e8b9ea12b6f.MOBFTAYNKMEGWUKJ.SEARCH&ppt=sp&ppn=sp&ssid=7pwv5n02i80000001599477917394&qH=0d6145b3003ac553',
      color: Colors.cyan,
      name: 'Realme 6i',
      specs: {
        'Cameras': '48 MP',
        'Front Camera': '16 MP, f/2.0, 26mm (wide), 1/3.06", 1.0µm',
        'Rear Camera': '48 MP, f/1.8, 26mm (wide), 1/2.0", 0.8µm, PDAF' +
            '\n' +
            '8 MP, f/2.3, 119˚ (ultrawide), 1/4.0", 1.12µm' +
            '\n' +
            '2 MP, f/2.4, (macro)' +
            '\n' +
            '2 MP B/W, f/2.4, (depth)',
        'Display': 'IPS LCD, 90Hz, 480 nits (typ)',
        'Processor': 'Mediatek MT6785 Helio G90T (12 nm)',
        'Performance': 'MT G90T',
        'Ratings': '4/10',
        'Storage': '64GB 4GB RAM, 64GB 6GB RAM',
        'Battery': '4300 mAh',
        'Resolution': '1080 x 2400 pixels, 20:9 ratio (~405 ppi density)',
      }),
  FilterPage(
      id: '16',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1f4q6Glw9a5q0OaceBjnw2K4WaZRyjPPo',
      buyLink:
          'https://www.flipkart.com/realme-narzo-20a-glory-silver-64-gb/p/itmca0d14f41a891?pid=MOBFVEATZATPNGVF&lid=LSTMOBFVEATZATPNGVFI6UYSB&marketplace=FLIPKART&srno=s_1_1&otracker=search&otracker1=search&fm=SEARCH&iid=e1438e98-41e1-479c-97ea-0f814c01f285.MOBFVEATZATPNGVF.SEARCH&ppt=sp&ppn=sp&ssid=u7m8ewilps0000001603711299574&qH=0b46c6590ff3d620',
      color: Colors.indigo[300],
      name: 'Realme Narzo 20A',
      specs: {
        'Cameras': '12 MP',
        'Front Camera': '8 MP',
        'Rear Camera':
            '12 MP, f/1.8, 28mm (wide), 1/2.8", 1.25µm, PDAF\n2 MP, f/2.4, (depth)\n2 MP, f/2.4, (depth)',
        'Display': 'IPS LCD',
        'Processor': 'Qualcomm SDM665 Snapdragon 665 (11 nm)',
        'Performance': 'SD 665',
        'Ratings': '5/10',
        'Storage': '32GB 3GB RAM, 64GB 4GB RAM',
        'Battery': '5000 mAh',
        'Resolution': '720 x 1600 pixels, 20:9 ratio (~270 ppi density)'
      }),
  FilterPage(
      id: '17',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1DElEz-qUA2P0KeWJN7yXPyrnPp3HB9TT',
      buyLink:
          'https://www.flipkart.com/realme-narzo-10a-so-white-32-gb/p/itmbeb412dade152?pid=MOBFQ36ASQHV3UGW&lid=LSTMOBFQ36ASQHV3UGWRF9MHV&marketplace=FLIPKART&srno=s_1_1&otracker=AS_QueryStore_OrganicAutoSuggest_2_11_na_na_ps&otracker1=AS_QueryStore_OrganicAutoSuggest_2_11_na_na_ps&fm=SEARCH&iid=74f3fd49-f0ad-4c0a-aaba-95cd0af12e52.MOBFQ36ASQHV3UGW.SEARCH&ppt=sp&ppn=sp&ssid=ctu5cfk4680000001599477938144&qH=9036ff25ac09bf22',
      color: Colors.blue[300],
      name: 'Realme Narzo 10a',
      specs: {
        'Cameras': '12 MP',
        'Front Camera': '5 MP, f/2.4, 28mm (wide), 1/5", 1.12µm',
        'Rear Camera': '12 MP, f/1.8, 28mm (wide), 1/2.8", 1.25µm, PDAF' +
            '\n' +
            '2 MP, f/2.4 (macro)' +
            '\n' +
            '2 MP, f/1.8, (depth)',
        'Display': 'IPS LCD, 480 nits (typ)',
        'Processor': 'Mediatek Helio G70 (12 nm)',
        'Performance': 'MT G70',
        'Ratings': '3/10',
        'Storage': '32GB 3GB RAM, 64GB 4GB RAM',
        'Battery': '5000 mAh',
        'Resolution': '720 x 1600 pixels, 20:9 ratio (~269 ppi density)',
      }),
  FilterPage(
      id: '18',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1kl9a79vMEliZ6rBSP3QmFHOIMU6p_LJp',
      buyLink:
          'https://www.flipkart.com/realme-narzo-10-that-blue-128-gb/p/itmfaa990ac54b7a?pid=MOBFST9QDGZTNRY8&lid=LSTMOBFST9QDGZTNRY8ESA6YM&marketplace=FLIPKART&srno=s_1_1&otracker=search&otracker1=search&fm=SEARCH&iid=e009e903-d0aa-423e-8211-f0eeb0c371e3.MOBFST9QDGZTNRY8.SEARCH&ppt=sp&ppn=sp&ssid=yeb3m8b0e80000001599477959463&qH=456ef728a14ea6c7',
      color: Colors.teal,
      name: 'Realme Narzo 10',
      specs: {
        'Cameras': '48 MP',
        'Front Camera': '16 MP, f/2.0, 26mm (wide), 1/3.06", 1.0µm',
        'Rear Camera': '48 MP, f/1.8, 26mm (wide), 1/2.0", 0.8µm, PDAF' +
            '\n' +
            '8 MP, f/2.3, 119˚ (ultrawide), 1/4.0", 1.12µm' +
            '\n' +
            '2 MP, f/2.4, (macro)' +
            '\n' +
            '2 MP B/W, f/2.4',
        'Display': 'IPS LCD, 480 nits (typ)',
        'Processor': 'Mediatek Helio G80 (12 nm)',
        'Performance': 'MT G80',
        'Ratings': '4/10',
        'Storage': '128GB 4GB RAM',
        'Battery': '5000 mAh',
        'Resolution': '720 x 1600 pixels, 20:9 ratio (~269 ppi density)',
      }),
  FilterPage(
      id: '19',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1MaXUOiKFS-g5bQwPT3YlIIbT_SFMS8pW',
      buyLink:
          'https://www.flipkart.com/realme-c15-power-silver-32-gb/p/itm70ebdb8a0fbdf?pid=MOBFUEPQCDMJSGFX&lid=LSTMOBFUEPQCDMJSGFXRX8BFA&marketplace=FLIPKART&srno=s_1_3&otracker=search&otracker1=search&fm=SEARCH&iid=b73189f4-e43c-4ea1-a3ef-7e870d4e2425.MOBFUEPQCDMJSGFX.SEARCH&ppt=sp&ppn=sp&ssid=pdfkcvyo400000001599477976697&qH=e7c76572a9a14b46',
      color: Colors.blue[400],
      name: 'Realme C15',
      specs: {
        'Cameras': '13 MP',
        'Front Camera': '8 MP, f/2.0, (wide)',
        'Rear Camera': '13 MP, f/2.2, (wide), PDAF' +
            '\n' +
            '8 MP, f/2.3, 119˚ (ultrawide)' +
            '\n' +
            '2 MP B/W, f/2.4' +
            '\n' +
            '2 MP, f/2.4',
        'Display': 'IPS LCD ',
        'Processor': 'MediaTek Helio G35 (12 nm)',
        'Performance': 'MT G35 ',
        'Ratings': '4/10',
        'Storage': '32GB 3GB RAM, 64GB 3GB RAM, 64GB 4GB RAM',
        'Battery': '6000 mAh',
        'Resolution': '720 x 1560 pixels, 20:9 ratio (~270 ppi density)',
      }),
  FilterPage(
      id: '20',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1P7m8soOjzWcY8iGlxroCJ2RWIkXYUMt7',
      buyLink:
          'https://www.flipkart.com/realme-c12-power-silver-32-gb/p/itm4854d77becc77?pid=MOBFUEPQEEDFBHCE&lid=LSTMOBFUEPQEEDFBHCEUX6BAW&marketplace=FLIPKART&srno=s_1_1&otracker=AS_Query_HistoryAutoSuggest_1_7_na_na_na&otracker1=AS_Query_HistoryAutoSuggest_1_7_na_na_na&fm=SEARCH&iid=794971d5-4092-4323-ad7e-6d957368d097.MOBFUEPQEEDFBHCE.SEARCH&ppt=sp&ppn=sp&ssid=zqoskhogm80000001603711351927&qH=7abfeadba17e7459',
      color: Colors.blue[300],
      name: 'Realme C12',
      specs: {
        'Cameras': ' 13 MP',
        'Front Camera': '5 MP, f/2.0, (wide)',
        'Rear Camera':
            '13 MP, f/2.2, (wide), PDAF\n2 MP B/W, f/2.4\n2 MP, f/2.4',
        'Display': 'IPS LCD',
        'Processor': 'MediaTek Helio G35 (12 nm)',
        'Performance': 'MT G35',
        'Ratings': '3/10',
        'Storage': '32GB 3GB RAM',
        'Battery': '6000 mAh',
        'Resolution': '720 x 1560 pixels, 19.5:9 ratio (~264 ppi density)',
      }),
  FilterPage(
      id: '21',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1xjKaxZnoYXhtXUitxklCuqoi_4C1-YzU',
      buyLink:
          'https://www.flipkart.com/realme-7-pro-mirror-silver-128-gb/p/itm72f96fb9b13c3?pid=MOBFUYUNBFV7PZZV&lid=LSTMOBFUYUNBFV7PZZVX4DOZD&marketplace=FLIPKART&srno=s_1_4&otracker=AS_QueryStore_OrganicAutoSuggest_1_10_na_na_ps&otracker1=AS_QueryStore_OrganicAutoSuggest_1_10_na_na_ps&fm=SEARCH&iid=e4f89d9e-3932-4b7c-9b72-e21017047fd1.MOBFUYUNBFV7PZZV.SEARCH&ppt=sp&ppn=sp&ssid=6s9bj1f17k0000001599478011427&qH=ee8e3d0c56f4f76e',
      color: Colors.blueGrey,
      name: 'Realme 7 Pro',
      specs: {
        'Cameras': '64 MP',
        'Front Camera': '32 MP, f/2.5, 24mm (wide), 1/2.8", 0.8µm',
        'Rear Camera': '64 MP, f/1.8, 26mm (wide), 1/1.73", 0.8µm, PDAF' +
            '\n' +
            '8 MP, f/2.3, 119˚, 16mm (ultrawide), 1/4.0", 1.12µm' +
            '\n' +
            '2 MP, f/2.4, (macro)' +
            '\n' +
            '2 MP, f/2.4, (depth)',
        'Display': 'Super AMOLED ',
        'Processor': 'Qualcomm SM7125 Snapdragon 720G (8 nm)',
        'Performance': 'SD 720G',
        'Ratings': '6/10',
        'Storage': '128GB 6GB RAM, 128GB 8GB RAM',
        'Battery': '4500 mAh',
        'Resolution': '1080 x 2400 pixels, 20:9 ratio (~411 ppi density)',
      }),
  FilterPage(
      id: '22',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1kv1EyLb8zWE6VA1UYPu9bbz7MGz0DTQ-',
      buyLink:
          'https://www.flipkart.com/realme-7-mist-white-64-gb/p/itme55d08631f19b?pid=MOBFUYUNDSH7NMVT&lid=LSTMOBFUYUNDSH7NMVT70L13F&marketplace=FLIPKART&srno=s_1_2&otracker=search&otracker1=search&fm=SEARCH&iid=4e9489ca-aad1-4bba-8807-1448f4920ca6.MOBFUYUNDSH7NMVT.SEARCH&ppt=sp&ppn=sp&ssid=gjor8p7mpc0000001599478038026&qH=e4e3e2cc50ce3144',
      color: Colors.blue[300],
      name: 'Realme 7',
      specs: {
        'Cameras': '64 MP',
        'Front Camera': '16 MP, f/2.1, 26mm (wide), 1/3.1", 1.0µm',
        'Rear Camera': '64 MP, f/1.8, 26mm (wide), 1/1.73", 0.8µm, PDAF' +
            '\n' +
            '8 MP, f/2.3, 119˚, 16mm (ultrawide), 1/4.0", 1.12µm' +
            '\n' +
            '2 MP, f/2.4, (macro)' +
            '\n' +
            '2 MP, f/2.4, (depth)',
        'Display': 'IPS LCD, 90Hz, 480 nits (typ)',
        'Processor': 'Mediatek Helio G95 (12 nm)',
        'Performance': 'MT G95',
        'Ratings': '7/10',
        'Storage': '64GB 6GB RAM, 128GB 8GB RAM',
        'Battery': '5000 mAh',
        'Resolution': '1080 x 2400 pixels, 20:9 ratio (~405 ppi density)',
      }),
  FilterPage(
      id: '23',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1WGbgmJuqfJ9_toOWWq55onlth2khlVLI',
      buyLink:
          'https://www.flipkart.com/realme-6-pro-lightning-red-64-gb/p/itmdddfecb342592?pid=MOBFPCX72FRDVFKB&lid=LSTMOBFPCX72FRDVFKBBVZBTU&marketplace=FLIPKART&srno=s_1_2&otracker=search&otracker1=search&fm=SEARCH&iid=a0eba36a-d7cb-4b23-8bde-6f72e8a52211.MOBFPCX72FRDVFKB.SEARCH&ppt=sp&ppn=sp&ssid=7qo1hljp0w0000001599478068743&qH=78d03ade33d3b96e',
      color: Colors.amber[800],
      name: 'Realme 6 Pro',
      specs: {
        'Cameras': '64 MP',
        'Front Camera': '16 MP, f/2.1, 26mm (wide), 1/3.06", 1.0µm' +
            '\n' +
            '8 MP, f/2.2, 105˚ (ultrawide), 1/4.0", 1.12µm',
        'Rear Camera': '64 MP, f/1.8, 26mm (wide), 1/1.72", 0.8µm, PDAF' +
            '\n' +
            '12 MP, f/2.5, 54mm (telephoto), 1/3.4", 1.0µm, PDAF, 2x optical zoom' +
            '\n' +
            '8 MP, f/2.3, 13mm (ultrawide), 1/4.0", 1.12µm' +
            '\n' +
            '2 MP, f/2.4, (macro)',
        'Display': 'IPS LCD, 90Hz, 480 nits (typ)',
        'Processor': 'Qualcomm SM7125 Snapdragon 720G (8 nm)',
        'Performance': 'SD 720G',
        'Ratings': '6/10',
        'Storage': '64GB 6GB RAM, 128GB 6GB RAM, 128GB 8GB RAM',
        'Battery': '4300 mAh',
        'Resolution': '1080 x 2400 pixels, 20:9 ratio (~399 ppi density)',
      }),
  FilterPage(
      id: '24',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1A-mW4jiSeVhnsWiedavFArvCWse-Virt',
      buyLink:
          'https://www.flipkart.com/realme-x2-pro-neptune-blue-64-gb/p/itma3203d88190a3?pid=MOBFM2WZG3BJWSBT&lid=LSTMOBFM2WZG3BJWSBTDJHSXS&marketplace=FLIPKART&srno=s_1_5&otracker=AS_QueryStore_OrganicAutoSuggest_1_13_na_na_ps&otracker1=AS_QueryStore_OrganicAutoSuggest_1_13_na_na_ps&fm=SEARCH&iid=c44060f6-83bd-4bd0-a548-c9a5d02a550e.MOBFM2WZG3BJWSBT.SEARCH&ppt=sp&ppn=sp&ssid=3h5yl8mhj40000001599478107230&qH=94c74c608d340ebc',
      color: Colors.blue[400],
      name: 'Realme X2 pro',
      specs: {
        'Cameras': '64 MP',
        'Front Camera': '16 MP, f/2.0, 25mm (wide), 1/3.06", 1.0µm',
        'Rear Camera': '64 MP, f/1.8, 26mm (wide), 1/1.72", 0.8µm, PDAF' +
            '\n' +
            '3 MP, f/2.5, 52mm (telephoto), 1/3.4", 1.0µm, PDAF, 2x optical zoom' +
            '\n' +
            '8 MP, f/2.2, 16mm (ultrawide)' +
            '\n' +
            '2 MP, f/2.4, (depth)',
        'Display': 'Super AMOLED, 90Hz, HDR10+, 1000 nits (peak)',
        'Processor': 'Qualcomm SM8150 Snapdragon 855+ (7 nm)',
        'Performance': 'SD 855+',
        'Ratings': '7/10',
        'Storage': '64GB 6GB RAM, 128GB 8GB RAM, 256GB 8GB RAM, 256GB 12GB RAM',
        'Battery': '4000 mAh',
        'Resolution': '1080 x 2400 pixels, 20:9 ratio (~402 ppi density)',
      }),
  FilterPage(
      id: '25',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1IaDer15Gpu8D1_VDmY41r7RLijFsS0JA',
      buyLink:
          'https://www.flipkart.com/realme-x3-arctic-white-128-gb/p/itm325a6e0c17b0a?pid=MOBFSS3Q86GGEYZA&lid=LSTMOBFSS3Q86GGEYZADP2HLD&marketplace=FLIPKART&srno=s_1_1&otracker=search&otracker1=search&fm=SEARCH&iid=c9de2d91-415c-4036-9f1b-6773a87cc948.MOBFSS3Q86GGEYZA.SEARCH&ppt=sp&ppn=sp&ssid=im5zwo2m740000001599478163432&qH=1ecb853d8732a809',
      color: Colors.green[300],
      name: 'Realme X3',
      specs: {
        'Cameras': '64 MP',
        'Front Camera': '16 MP, f/2.0, 26mm (wide), 1/3.06", 1.0µm' +
            '\n' +
            '8 MP, f/2.2, 105˚ (ultrawide), 1/4.0", 1.12µm',
        'Rear Camera': '64 MP, f/1.8, 26mm (wide), 1/1.72", 0.8µm, PDAF' +
            '\n' +
            '12 MP, f/2.5, 51mm (telephoto), PDAF, 2x optical zoom' +
            '\n' +
            '8 MP, f/2.3, 119˚, 16mm (ultrawide), 1/4.0", 1.12µm' +
            '\n' +
            '2 MP, f/2.4, (macro)',
        'Display': 'IPS LCD, 120Hz',
        'Processor': 'Qualcomm SM8150 Snapdragon 855+ (7 nm)',
        'Performance': 'SD 855+',
        'Ratings': '8/10',
        'Storage': '128GB 6GB RAM, 128GB 8GB RAM',
        'Battery': '4200 mAh',
        'Resolution': '1080 x 2400 pixels, 20:9 ratio (~399 ppi density)',
      }),
  FilterPage(
      id: '26',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1j18uv0MgNNlVSIDUdz1_ac34BgQUVIeC',
      buyLink:
          'https://www.flipkart.com/realme-x3-arctic-white-128-gb/p/itm325a6e0c17b0a?pid=MOBFSS3Q86GGEYZA&lid=LSTMOBFSS3Q86GGEYZADP2HLD&marketplace=FLIPKART&srno=s_1_1&otracker=search&otracker1=search&fm=SEARCH&iid=c9de2d91-415c-4036-9f1b-6773a87cc948.MOBFSS3Q86GGEYZA.SEARCH&ppt=sp&ppn=sp&ssid=im5zwo2m740000001599478163432&qH=1ecb853d8732a809',
      color: Colors.teal[200],
      name: 'Realme X3 SuperZoom',
      specs: {
        'Cameras': '64 MP',
        'Front Camera': '32 MP, f/2.5, 26mm (wide), 1/2.8", 0.8µm' +
            '\n' +
            '8 MP, f/2.2, 105˚ (ultrawide), 1/4.0", 1.12µm',
        'Rear Camera': '64 MP, f/1.8, 26mm (wide), 1/1.72", 0.8µm, PDAF' +
            '\n' +
            '8 MP, f/3.4, 124mm (periscope telephoto), PDAF, OIS, 5x optical zoom' +
            '\n' +
            '8 MP, f/2.3, 119˚, 16mm (ultrawide), 1/4.0", 1.12µm' +
            '\n' +
            '2 MP, f/2.4, (macro)',
        'Display': 'IPS LCD, 120Hz',
        'Processor': 'Qualcomm SM8150 Snapdragon 855+ (7 nm)',
        'Performance': 'SD 855+',
        'Ratings': '8/10',
        'Storage': '128GB 8GB RAM, 256GB 12GB RAM',
        'Battery': '4200 mAh',
        'Resolution': '1080 x 2400 pixels, 20:9 ratio (~399 ppi density)',
      }),
  FilterPage(
      id: '27',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1BB6M99VMiQ3VZXakJDQRSjeDV6rHbfry',
      buyLink:
          'https://www.flipkart.com/realme-x50-pro-moss-green-128-gb/p/itm13d1770db35a3?pid=MOBFP6WYZGFBGHFE&lid=LSTMOBFP6WYZGFBGHFE2QDC38&marketplace=FLIPKART&srno=s_1_1&otracker=search&otracker1=search&fm=SEARCH&iid=439200b0-1ff3-4f18-a630-b4a8bb8bfc6d.MOBFP6WYZGFBGHFE.SEARCH&ppt=sp&ppn=sp&ssid=voysws0dds0000001599478237235&qH=77fc0bc675b781b4',
      color: Colors.red[200],
      name: 'Realme X50 Pro 5G',
      specs: {
        'Cameras': '64 MP',
        'Front Camera': '32 MP, f/2.5, 26mm (wide), 1/2.8", 0.8µm' +
            '\n' +
            '8 MP, f/2.2, 17mm (ultrawide), 1/4.0", 1.12µm',
        'Rear Camera': '64 MP, f/1.8, 26mm (wide), 1/1.72", 0.8µm, PDAF' +
            '\n' +
            '12 MP, f/2.5, 54mm (telephoto), 2x optical zoom, PDAF' +
            '\n' +
            '8 MP, f/2.3, 13mm (ultrawide), PDAF' +
            '\n' +
            '2 MP B/W, f/2.4, (depth)',
        'Display': 'Super AMOLED, 90Hz, HDR10+',
        'Processor': 'Qualcomm SM8250 Snapdragon 865 (7 nm+)',
        'Performance': 'SD 865 ',
        'Ratings': '8/10',
        'Storage':
            '128GB 6GB RAM, 128GB 8GB RAM, 256GB 8GB RAM, 256GB 12GB RAM',
        'Battery': '4200 mAh',
        'Resolution': '1080 x 2400 pixels, 20:9 ratio (~409 ppi density)',
      }),
  FilterPage(
      id: '28',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=12Ny0vmp10JQ86a8kZpzQlxT8ew97oe1-',
      buyLink:
          'https://www.flipkart.com/asus-rog-phone-3-black-128-gb/p/itm93ba84fa7cce9?pid=MOBFTHGZEYPWHGHE&lid=LSTMOBFTHGZEYPWHGHE6FE3GU&marketplace=FLIPKART&srno=s_1_1&otracker=AS_QueryStore_OrganicAutoSuggest_1_11_na_na_ps&otracker1=AS_QueryStore_OrganicAutoSuggest_1_11_na_na_ps&fm=SEARCH&iid=27bd59c5-83c9-46d3-91fd-84cc7a257e1c.MOBFTHGZEYPWHGHE.SEARCH&ppt=sp&ppn=sp&ssid=868f82yytc0000001599478293978&qH=c9a72c4f6ca8e0e4',
      color: Colors.black,
      name: 'ROG phone 3',
      specs: {
        'Cameras': '64 MP',
        'Front Camera': '24 MP, f/2.0, 27mm (wide), 0.9µm',
        'Rear Camera': '64 MP, f/1.8, 26mm (wide), 1/1.72", 0.8µm, PDAF' +
            '\n' +
            '13 MP, f/2.4, 125˚, 11mm (ultrawide)' +
            '\n' +
            '5 MP, f/2.0, (macro)',
        'Display': 'AMOLED, 1B colors, 144Hz, HDR10+, 650 nits (typ)',
        'Processor': 'Qualcomm SM8250 Snapdragon 865+ (7 nm+)',
        'Performance': 'SD 865+',
        'Ratings': '9/10',
        'Storage':
            '128GB 8GB RAM, 128GB 12GB RAM, 256GB 12GB RAM, 512GB 12GB RAM, 512GB 16GB RAM',
        'Battery': '6000 mAh',
        'Resolution': '1080 x 2340 pixels, 19.5:9 ratio (~391 ppi density)',
      }),
  FilterPage(
      id: '29',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=10rV7deZf2_-hRjRBt0fpoAZALJhB9gsC',
      buyLink:
          'https://www.flipkart.com/asus-rog-phone-ii-black-128-gb/p/itm99be8e028a908?pid=MOBFK5TPW6UFVZGR&lid=LSTMOBFK5TPW6UFVZGRIIBD2S&marketplace=FLIPKART&srno=s_1_1&otracker=search&otracker1=search&fm=SEARCH&iid=7b6e1868-e3b8-4909-b03e-a7833f2d78c8.MOBFK5TPW6UFVZGR.SEARCH&ppt=sp&ppn=sp&ssid=9bt5n1d9uo0000001599478329859&qH=a8595ec564cc34c1',
      color: Colors.black,
      name: 'ROG phone 2',
      specs: {
        'Cameras': '48 MP',
        'Front Camera': '24MP, f/2.2, 0.9µm',
        'Rear Camera':
            '48 MP, f/1.8, 26mm (wide), 1/2.0", 0.8µm, PDAF, Laser AF' +
                '\n' +
                '13 MP, f/2.4, 11mm (ultrawide)',
        'Display': 'AMOLED, 1B colors, 120Hz, HDR10',
        'Processor': 'Qualcomm SM8150 Snapdragon 855+ (7 nm)',
        'Performance': 'SD 855+',
        'Ratings': '8/10',
        'Storage':
            '128GB 8GB RAM, 256GB 12GB RAM, 512GB 12GB RAM, 1TB 12GB RAM',
        'Battery': '6000 mAh',
        'Resolution': '1080 x 2340 pixels, 19.5:9 ratio (~391 ppi density)',
      }),
  FilterPage(
      id: '30',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1cBlNSwIA47tQeTZVRPeXHjp_i0x8p-Rk',
      buyLink: 'https://amzn.to/3opH3Hr',
      color: Colors.teal,
      name: 'Oneplus  8T',
      specs: {
        'Cameras': '48 MP',
        'Front Camera': '16 MP, f/2.4, (wide), 1/3.06", 1.0µm',
        'Rear Camera':
            '48 MP, f/1.7, 26mm (wide), 1/2.0", 0.8µm, PDAF, OIS\n16 MP, f/2.2, 14mm, 123˚ (ultrawide), 1/3.6", 1.0µm\n5 MP, f/2.4, (macro)\n2 MP, f/2.4, (depth)',
        'Display': 'Fluid AMOLED, 120Hz, HDR10+0',
        'Processor': 'Qualcomm SM8250 Snapdragon 865 (7 nm+)',
        'Performance': 'SD 865 ',
        'Ratings': '9/10',
        'Storage': '128GB 8GB RAM, 256GB 12GB RAM',
        'Battery': '4500 mAh',
        'Resolution': '1080 x 2400 pixels, 20:9 ratio (~402 ppi density)'
      }),
  FilterPage(
      id: '31',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1CMGXnHrTjHkyTnxNj9C6vmPGWNDH6Nhm',
      buyLink: 'https://amzn.to/32ZUm7C',
      color: Colors.teal[200],
      name: 'Oneplus 8 Pro',
      specs: {
        'Cameras': '48 MP',
        'Front Camera': '16 MP, f/2.5, (wide), 1/3.06", 1.0µm',
        'Rear Camera':
            '48 MP, f/1.8, 25mm (wide), 1/1.43", 1.12µm, omnidirectional PDAF, Laser AF, OIS' +
                '\n' +
                '8 MP, f/2.4, (telephoto), 1/1.0µm, PDAF, OIS, 3x optical zoom' +
                '\n' +
                '48 MP, f/2.2, 14mm, 116˚ (ultrawide), 1/2.0", 0.8µm, PDAF' +
                '\n' +
                '5 MP, f/2.4, (Color filter camera)',
        'Display': 'Fluid AMOLED, 1B colors, 120Hz, HDR10+',
        'Processor': 'Qualcomm SM8250 Snapdragon 865 (7 nm+)',
        'Performance': 'SD 865 ',
        'Ratings': '10/10',
        'Storage': '128GB 8GB RAM, 256GB 12GB RAM',
        'Battery': '4510 mAh',
        'Resolution': '1440 x 3168 pixels (~513 ppi density)',
      }),
  FilterPage(
      id: '32',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1IGzxCcJKMAiFqvUAqb8AnyXjJioUcoLW',
      buyLink: 'https://amzn.to/2FcqNaC',
      color: Colors.teal[50],
      name: 'Oneplus 8',
      specs: {
        'Cameras': '48 MP',
        'Front Camera': '16 MP, f/2.4, (wide), 1/3.06", 1.0µm',
        'Rear Camera': '48 MP, f/1.8, 26mm (wide), 1/2.0", 0.8µm, PDAF, OIS' +
            '\n' +
            '16 MP, f/2.2, 14mm, 116˚ (ultrawide), 1/3.6", 1.0µm' +
            '\n' +
            '2 MP, f/2.4, (macro)',
        'Display': 'Fluid AMOLED, 90Hz, HDR10+',
        'Processor': 'Qualcomm SM8250 Snapdragon 865 (7 nm+)',
        'Performance': 'SD 865 ',
        'Ratings': '8/10',
        'Storage': '128GB 8GB RAM, 256GB 12GB RAM',
        'Battery': '4300 mAh',
        'Resolution': '1080 x 2400 pixels, 20:9 ratio (~402 ppi density)',
      }),
  FilterPage(
      id: '33',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=12YpcSQ2NcRWdNjFVZPZ2Lj3UeERhxMXS',
      buyLink: 'https://amzn.to/2FhNOc4',
      color: Colors.cyan[100],
      name: 'Oneplus 7T Pro',
      specs: {
        'Cameras': '48 MP',
        'Front Camera':
            'Motorized pop-up 16 MP, f/2.0, 25mm (wide), 1/3.06", 1.0µm',
        'Rear Camera':
            '48 MP, f/1.6, (wide), 1/2.0", 0.8µm, PDAF, Laser AF, OIS' +
                '\n' +
                '8 MP, f/2.4, 78mm (telephoto), 3x optical zoom, PDAF, OIS' +
                '\n' +
                '16 MP, f/2.2, 17mm (ultrawide), AF',
        'Display': 'Fluid AMOLED, 90Hz, HDR10+',
        'Processor': 'Qualcomm SM8150 Snapdragon 855+ (7 nm)',
        'Performance': 'SD 855+',
        'Ratings': '8/10',
        'Storage': '256GB 8GB RAM, 256GB 12GB RAM',
        'Battery': '4085 mAh',
        'Resolution': '1440 x 3120 pixels, 19.5:9 ratio (~516 ppi density)',
      }),
  FilterPage(
      id: '34',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1RKgbRD_VoHVIhC2fjyEPRpgFsUsyPOv0',
      buyLink: 'https://amzn.to/323fHxJ',
      color: Colors.blue[100],
      name: 'Oneplus 7T',
      specs: {
        'Cameras': '48 MP',
        'Front Camera': '16 MP, f/2.0, 25mm (wide), 1/3.06", 1.0µm',
        'Rear Camera': '48 MP, f/1.6, 26mm (wide), 1/2.0", 0.8µm, PDAF, OIS' +
            '\n' +
            '12 MP, f/2.2, 51mm (telephoto), 1.0µm, PDAF, 2x optical zoom' +
            '\n' +
            '16 MP, f/2.2, 17mm (ultrawide), AF',
        'Display': 'Fluid AMOLED, 90Hz, HDR10+',
        'Processor': 'Qualcomm SM8150 Snapdragon 855+ (7 nm)',
        'Performance': 'SD 855+',
        'Ratings': '8/10',
        'Storage': '128GB 8GB RAM, 256GB 8GB RAM',
        'Battery': '3800 mAh',
        'Resolution': '1080 x 2400 pixels, 20:9 ratio (~402 ppi density)',
      }),
  FilterPage(
      id: '35',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1GCNtaSkrozkjXTXb8yFWylldo1NcOZ1h',
      buyLink: 'https://amzn.to/3iaqNGL',
      color: Colors.red[300],
      name: 'Oneplus 7 Pro',
      specs: {
        'Cameras': '48 MP',
        'Front Camera':
            'Motorized pop-up 16 MP, f/2.0, 25mm (wide), 1/3.06", 1.0µm',
        'Rear Camera':
            '48 MP, f/1.6, (wide), 1/2.0", 0.8µm, PDAF, Laser AF, OIS' +
                '\n' +
                '8 MP, f/2.4, 78mm (telephoto), 3x optical zoom, PDAF, OIS' +
                '\n' +
                '16 MP, f/2.2, 17mm (ultrawide), AF',
        'Display': 'Fluid AMOLED, 90Hz, HDR10+',
        'Processor': 'Qualcomm SM8150 Snapdragon 855 (7 nm)',
        'Performance': 'SD 855 ',
        'Ratings': '8/10',
        'Storage': '128GB 6GB RAM, 256GB 8GB RAM, 256GB 12GB RAM',
        'Battery': '4000 mAh',
        'Resolution': '1440 x 3120 pixels, 19.5:9 ratio (~516 ppi density)',
      }),
  FilterPage(
      id: '36',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=18mUSIWUbOcDztw4A2DRUT83fOUmgDkOM',
      buyLink:
          'https://www.amazon.in/b?ie=UTF8&node=21676199031&store_ref=SB_A00974722GK2IV2E58YDM&pf_rd_p=5775ea14-b20a-49eb-bd4c-85167727c16e&aaxitk=D9Un374gEB02FFwNefbGHw&hsa_cr_id=2663646780202&lp_mat_key=oneplus%20nord&lp_query=oneplus%20nord&lp_slot=auto-sparkle-hsa-tetris&ref_=sbx_be_s_sparkle_nafd_hl',
      color: Colors.cyan[200],
      name: 'Oneplus Nord',
      specs: {
        'Cameras': '48 MP',
        'Front Camera': '32 MP, f/2.5, (wide), 1/2.8", 0.8µm' +
            '\n' +
            '8 MP, f/2.5, 105˚ (ultrawide), 1/4.0", 1.12µm',
        'Rear Camera': '48 MP, f/1.8, 26mm (wide), 1/2.0", 0.8µm, PDAF, OIS' +
            '\n' +
            '8 MP, f/2.3, 119˚ (ultrawide)' +
            '\n' +
            '5 MP, f/2.4, (depth)' +
            '\n' +
            '2 MP, f/2.4, (macro)',
        'Display': 'Fluid AMOLED, 90Hz, HDR10+',
        'Processor': 'Qualcomm SDM765 Snapdragon 765G (7 nm)',
        'Performance': 'SD 765G',
        'Ratings': '7/10',
        'Storage': '64GB 6GB RAM, 128GB 8GB RAM, 256GB 12GB RAM',
        'Battery': '4115 mAh',
        'Resolution': '1080 x 2400 pixels, 20:9 ratio (~408 ppi density)',
      }),
  FilterPage(
      id: '37',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1UxoAgcZ_L2sRxiljrITskBQMMPrn5ZYK',
      buyLink:
          'https://www.amazon.in/New-Apple-iPhone-Pro-128GB/dp/B08L5VZKWT?ref_=ast_sto_dp',
      color: Colors.indigo[400],
      name: 'iPhone 12 Pro Max',
      specs: {
        'Cameras': '12 MP',
        'Front Camera':
            '12 MP, f/2.2, 23mm (wide), 1/3.6"\nSL 3D, (depth/biometrics sensor)',
        'Rear Camera':
            ' 12 MP, f/1.6, 26mm (wide), 1.7µm, dual pixel PDAF, sensor-shift OIS\n12 MP, f/2.2, 65mm (telephoto), 1/3.4", 1.0µm, PDAF, OIS, 2.5x optical zoom\n12 MP, f/2.4, 120˚, 13mm (ultrawide), 1/3.6"\nTOF 3D LiDAR scanner (depth)',
        'Display':
            'Super Retina XDR OLED, HDR10, 800 nits (typ), 1200 nits (peak)',
        'Processor': 'Apple A14 Bionic (5 nm)',
        'Performance': 'Apple A14',
        'Ratings': '10/10',
        'Storage': '128GB 6GB RAM, 256GB 6GB RAM, 512GB 6GB RAM',
        'Battery': '3687 mAh',
        'Resolution': '1284 x 2778 pixels, 19.5:9 ratio (~458 ppi density)'
      }),
  FilterPage(
      id: '38',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1zBzGto293m0W8EZMTeAFdjMhK0huLml_',
      buyLink:
          'https://www.amazon.in/New-Apple-iPhone-Pro-128GB/dp/B08L5V9T31?ref_=ast_sto_dp',
      color: Colors.red[300],
      name: 'iPhone 12 Pro',
      specs: {
        'Cameras': '12 MP',
        'Front Camera':
            '12 MP, f/2.2, 23mm (wide), 1/3.6"\nSL 3D, (depth/biometrics sensor)',
        'Rear Camera':
            '12 MP, f/1.6, 26mm (wide), 1.4µm, dual pixel PDAF, OIS\n12 MP, f/2.0, 52mm (telephoto), 1/3.4", 1.0µm, PDAF, OIS, 2x optical zoom\n12 MP, f/2.4, 120˚, 13mm (ultrawide), 1/3.6"\nTOF 3D LiDAR scanner (depth)',
        'Display':
            'Super Retina XDR OLED, HDR10, 800 nits (typ), 1200 nits (peak)',
        'Processor': 'Apple A14 Bionic (5 nm)',
        'Performance': 'Apple A14',
        'Ratings': '9/10',
        'Storage': '128GB 6GB RAM, 256GB 6GB RAM, 512GB 6GB RAM',
        'Battery': '2815 mAh',
        'Resolution': '1170 x 2532 pixels, 19.5:9 ratio (~460 ppi density)'
      }),
  FilterPage(
      id: '39',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=11jF8ZB4D9abVQAGIEVsyau7IrnZcu0m5',
      buyLink:
          'https://www.flipkart.com/apple-iphone-12-black-64-gb/p/itma2559422bf7c7?pid=MOBFWBYZU5FWK2VP&lid=LSTMOBFWBYZU5FWK2VP98XIL4&marketplace=FLIPKART&srno=s_1_2&otracker=search&otracker1=search&fm=SEARCH&iid=39047d27-5d2c-4ace-a358-2da345c3f5b7.MOBFWBYZU5FWK2VP.SEARCH&ppt=sp&ppn=sp&ssid=lmgn7hjnpc0000001603711815823&qH=7b7504afcaf2e1ea',
      color: Colors.blue[400],
      name: 'iPhone 12',
      specs: {
        'Cameras': '12 MP',
        'Front Camera':
            '12 MP, f/2.2, 23mm (wide), 1/3.6"\nSL 3D, (depth/biometrics sensor)',
        'Rear Camera':
            '12 MP, f/1.6, 26mm (wide), 1.4µm, dual pixel PDAF, OIS\n12 MP, f/2.4, 120˚, 13mm (ultrawide), 1/3.6"',
        'Display':
            'Super Retina XDR OLED, HDR10, 625 nits (typ), 1200 nits (peak)',
        'Processor': 'Apple A14 Bionic (5 nm)',
        'Performance': 'Apple A14',
        'Ratings': '9/10',
        'Storage': '64GB 4GB RAM, 128GB 4GB RAM, 256GB 4GB RAM',
        'Battery': '2815 mAh',
        'Resolution': '1170 x 2532 pixels, 19.5:9 ratio (~460 ppi density)'
      }),
  FilterPage(
      id: '40',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1kRDLxsNcbEhnguUkYFaMUqDJ8Vm9RVOy',
      buyLink:
          'https://www.amazon.in/New-Apple-iPhone-Mini-64GB/dp/B08L5TDRQC?ref_=ast_sto_dp',
      color: Colors.blue[400],
      name: 'iPhone 12 Mini',
      specs: {
        'Cameras': '12 MP',
        'Front Camera':
            '12 MP, f/2.2, 23mm (wide), 1/3.6"\nSL 3D, (depth/biometrics sensor)',
        'Rear Camera':
            '12 MP, f/1.6, 26mm (wide), 1.4µm, dual pixel PDAF, OIS\n12 MP, f/2.4, 120˚, 13mm (ultrawide), 1/3.6"',
        'Display':
            'Super Retina XDR OLED, HDR10, 625 nits (typ), 1200 nits (peak)',
        'Processor': 'Apple A14 Bionic (5 nm)',
        'Performance': 'Apple A14',
        'Ratings': '9/10',
        'Storage': '64GB, 128GB, 256GB',
        'Battery': '2227 mAh',
        'Resolution': '1080 x 2340 pixels, 19.5:9 ratio (~476 ppi density)'
      }),
  FilterPage(
      id: '41',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1qLVv7UDa1FB5QJ9nOSNr3HCqRQqZw08p',
      buyLink: 'https://amzn.to/35c8CNl',
      color: Colors.teal[300],
      name: 'iPhone 11 Pro Max',
      specs: {
        'Cameras': '12 MP',
        'Front Camera': '12 MP, f/2.2, 23mm (wide), 1/3.6"' +
            '\n' +
            'SL 3D, (depth/biometrics sensor)',
        'Rear Camera':
            '12 MP, f/1.8, 26mm (wide), 1/2.55", 1.4µm, dual pixel PDAF, OIS' +
                '\n' +
                '12 MP, f/2.0, 52mm (telephoto), 1/3.4", 1.0µm, PDAF, OIS, 2x optical zoom' +
                '\n' +
                '12 MP, f/2.4, 120˚, 13mm (ultrawide), 1/3.6"',
        'Display':
            'Super Retina XDR OLED, HDR10, 800 nits (typ), 1200 nits (peak)',
        'Processor': 'Apple A13 Bionic (7 nm+)',
        'Performance': 'Apple A13',
        'Ratings': '9/10',
        'Storage': '64GB 4GB RAM, 256GB 4GB RAM, 512GB 4GB RAM',
        'Battery': '3969 mAh',
        'Resolution': '1242 x 2688 pixels, 19.5:9 ratio (~458 ppi density)',
      }),
  FilterPage(
      id: '42',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1xzrnYEO3TzsqXe_Wraty507NkCgmSwZz',
      buyLink: 'https://amzn.to/3i2lY2a',
      color: Colors.teal[300],
      name: 'iPhone 11 Pro',
      specs: {
        'Cameras': '12 MP',
        'Front Camera': '12 MP, f/2.2, 23mm (wide), 1/3.6"' +
            '\n' +
            'SL 3D, (depth/biometrics sensor)',
        'Rear Camera':
            '12 MP, f/1.8, 26mm (wide), 1/2.55", 1.4µm, dual pixel PDAF, OIS' +
                '\n' +
                '12 MP, f/2.0, 52mm (telephoto), 1/3.4", 1.0µm, PDAF, OIS, 2x optical zoom' +
                '\n' +
                '12 MP, f/2.4, 120˚, 13mm (ultrawide), 1/3.6"',
        'Display':
            'Super Retina XDR OLED, HDR10, 800 nits (typ), 1200 nits (peak)',
        'Processor': 'Apple A13 Bionic (7 nm+)',
        'Performance': 'Apple A13',
        'Ratings': '8/10',
        'Storage': '64GB 4GB RAM, 256GB 4GB RAM, 512GB 4GB RAM',
        'Battery': '3046 mAh',
        'Resolution': '1125 x 2436 pixels, 19.5:9 ratio (~458 ppi density)',
      }),
  FilterPage(
      id: '43',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1dqzrag3O_3xq7wHyxw2RzaA19Vc4vj5M',
      buyLink: 'https://amzn.to/2FcpDvM',
      color: Colors.blue[100],
      name: 'iPhone 11',
      specs: {
        'Cameras': '12 MP',
        'Front Camera': '12 MP, f/2.2, 23mm (wide), 1/3.6"' +
            '\n' +
            'SL 3D, (depth/biometrics sensor)',
        'Rear Camera':
            '12 MP, f/1.8, 26mm (wide), 1/2.55", 1.4µm, dual pixel PDAF, OIS' +
                '\n' +
                '12 MP, f/2.4, 120˚, 13mm (ultrawide), 1/3.6"',
        'Display': 'Liquid Retina IPS LCD, 625 nits (typ)',
        'Processor': 'Apple A13 Bionic (7 nm+)',
        'Performance': 'Apple A13',
        'Ratings': '8/10',
        'Storage': '64GB 4GB RAM, 128GB 4GB RAM, 256GB 4GB RAM',
        'Battery': '3110 mAh',
        'Resolution': '828 x 1792 pixels, 19.5:9 ratio (~326 ppi density)',
      }),
  FilterPage(
      id: '44',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1zGVZwiJTOA9p_lZV8ajybi8xGsbkeSbh',
      buyLink:
          'https://www.flipkart.com/apple-iphone-se-black-64-gb/p/itm832dd5963a08d?pid=MOBFRFXHCKWDAC4A&lid=LSTMOBFRFXHCKWDAC4AEQROVZ&marketplace=FLIPKART&srno=s_1_1&otracker=search&otracker1=search&fm=SEARCH&iid=4a172d70-7022-4ca6-a395-4a78c991f0d2.MOBFRFXHCKWDAC4A.SEARCH&ppt=sp&ppn=sp&ssid=lzxzi13vi80000001599478445569&qH=417360a05fc3522d',
      color: Colors.lime[400],
      name: 'iPhone SE',
      specs: {
        'Cameras': '12 MP',
        'Front Camera': '7 MP, f/2.2',
        'Rear Camera': '12 MP, f/1.8 (wide), PDAF, OIS',
        'Display': 'Retina IPS LCD, 625 nits (typ)',
        'Processor': 'Apple A13 Bionic (7 nm+)',
        'Performance': 'Apple A13',
        'Ratings': '6/10',
        'Storage': '64GB 3GB RAM, 128GB 3GB RAM, 256GB 3GB RAM',
        'Battery': '1821 mAh',
        'Resolution': '750 x 1334 pixels, 16:9 ratio (~326 ppi density)',
      }),
  FilterPage(
      id: '45',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1K1_Hf-Yo8vOKgBTY3fDfjsaB6mrzr5kV',
      buyLink: 'https://amzn.to/3bxYDTu',
      color: Colors.yellow,
      name: 'iPhone XS Max',
      specs: {
        'Cameras': '12 MP',
        'Front Camera': '7 MP, f/2.2, 32mm (standard)' +
            '\n' +
            'SL 3D, (depth/biometrics sensor)',
        'Rear Camera':
            '12 MP, f/1.8, 26mm (wide), 1/2.55", 1.4µm, dual pixel PDAF, OIS' +
                '\n' +
                '12 MP, f/2.4, 52mm (telephoto), 1/3.4", 1.0µm, PDAF, OIS, 2x optical zoom',
        'Display': 'Super Retina OLED, HDR10, 625 nits (typ)',
        'Processor': 'Apple A12 Bionic (7 nm)',
        'Performance': 'Apple A12',
        'Ratings': '7/10',
        'Storage': '64GB 4GB RAM, 256GB 4GB RAM, 512GB 4GB RAM',
        'Battery': '3174 mAh',
        'Resolution': '1242 x 2688 pixels, 19.5:9 ratio (~458 ppi density)',
      }),
  FilterPage(
      id: '46',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1JxQX1mFuIYeD-A5Ro0tm47iEKaG9C12Y',
      buyLink:
          'https://www.flipkart.com/apple-iphone-xs-max-space-grey-64-gb/p/itmf944egfh8mgvg?pid=MOBF944EEFJDUYH6&lid=LSTMOBF944EEFJDUYH6KPGGOK&marketplace=FLIPKART&srno=s_1_10&otracker=search&otracker1=search&fm=SEARCH&iid=e73bdfbe-1474-46ba-99ee-ec4990c7eb1a.MOBF944EEFJDUYH6.SEARCH&ppt=sp&ppn=sp&ssid=5nw9rf2k740000001599478653190&qH=25d150cd46c7b25c',
      color: Colors.yellow,
      name: 'iPhone XS',
      specs: {
        'Cameras': '12 MP',
        'Front Camera': '7 MP, f/2.2, 32mm (standard)' +
            '\n' +
            'SL 3D, (depth/biometrics sensor)',
        'Rear Camera':
            '12 MP, f/1.8, 26mm (wide), 1/2.55", 1.4µm, dual pixel PDAF, OIS' +
                '\n' +
                '12 MP, f/2.4, 52mm (telephoto), 1/3.4", 1.0µm, PDAF, OIS, 2x optical zoom',
        'Display': 'Super Retina OLED, HDR10, 625 nits (typ)',
        'Processor': 'Apple A12 Bionic (7 nm)',
        'Performance': 'Apple A12',
        'Ratings': '7/10',
        'Storage': '64GB 4GB RAM, 256GB 4GB RAM, 512GB 4GB RAM',
        'Battery': '2658 mAh',
        'Resolution': '1125 x 2436 pixels, 19.5:9 ratio (~458 ppi density)',
      }),
  FilterPage(
      id: '47',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1Q9wDtLg-o-6avHOAIjpUyjYtBQ4WSGXS',
      buyLink:
          'https://www.flipkart.com/apple-iphone-xr-black-64-gb/p/itmf9z7zxu4uqyz2?pid=MOBF9Z7ZPHGV4GNH&lid=LSTMOBF9Z7ZPHGV4GNH9IFADQ&marketplace=FLIPKART&srno=s_1_1&otracker=search&otracker1=search&fm=SEARCH&iid=64fb47d5-6ea5-4370-9846-73fc0a05d78d.MOBF9Z7ZPHGV4GNH.SEARCH&ppt=sp&ppn=sp&ssid=02gud34fcw0000001599478755145&qH=651153a0fac18d29',
      color: Colors.cyan[300],
      name: 'iPhone XR',
      specs: {
        'Cameras': '12 MP',
        'Front Camera': '7 MP, f/2.2, 32mm (standard)' +
            '\n' +
            'SL 3D, (depth/biometrics sensor)',
        'Rear Camera': '12 MP, f/1.8, 26mm (wide), 1/2.55", 1.4µm, PDAF, OIS',
        'Display': 'Liquid Retina IPS LCD, 625 nits (typ)',
        'Processor': 'Apple A12 Bionic (7 nm)',
        'Performance': 'Apple A12',
        'Ratings': '7/10',
        'Storage': '64GB 3GB RAM, 128GB 3GB RAM, 256GB 3GB RAM',
        'Battery': '2942 mAh',
        'Resolution': '828 x 1792 pixels, 19.5:9 ratio (~326 ppi density)',
      }),
  FilterPage(
      id: '48',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1j8o02uPwR3hrGB8ZgHgCgKzn_7qstXmW',
      buyLink: 'https://store.google.com/magazine/compare_pixel',
      color: Colors.orange[200],
      name: 'Pixel 4 XL',
      specs: {
        'Cameras': '12.2 ',
        'Front Camera': '8 MP, f/2.0, 22mm (wide), 1.22µm, no AF' +
            '\n' +
            'TOF 3D, (depth/biometrics sensor)',
        'Rear Camera':
            '12.2 MP, f/1.7, 27mm (wide), 1/2.55", 1.4µm, dual pixel PDAF, OIS' +
                '\n' +
                '16 MP, f/2.4, 50mm (telephoto), 1/3.6", 1.0µm, PDAF, OIS, 2x optical zoom',
        'Display': 'P-OLED, 90Hz, HDR',
        'Processor': 'Qualcomm SM8150 Snapdragon 855 (7 nm)',
        'Performance': 'SD 855 ',
        'Ratings': '8/10',
        'Storage': '64GB 6GB RAM, 128GB 6GB RAM',
        'Battery': '3700 mAh',
        'Resolution': '1440 x 3040 pixels, 19:9 ratio (~537 ppi density)',
      }),
  FilterPage(
      id: '49',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1-r2DGb8Endhq64dZ9gK6w1AzuJ2t9Euu',
      buyLink: 'https://store.google.com/magazine/compare_pixel',
      color: Colors.red[400],
      name: 'Pixel 4',
      specs: {
        'Cameras': '12.2 ',
        'Front Camera': '8 MP, f/2.0, 22mm (wide), 1.22µm, no AF' +
            '\n' +
            'TOF 3D, (depth/biometrics sensor)',
        'Rear Camera':
            '12.2 MP, f/1.7, 27mm (wide), 1/2.55", 1.4µm, dual pixel PDAF, OIS' +
                '\n' +
                '16 MP, f/2.4, 50mm (telephoto), 1/3.6", 1.0µm, PDAF, OIS, 2x optical zoom',
        'Display': 'P-OLED, 90Hz, HDR',
        'Processor': 'Qualcomm SM8150 Snapdragon 855 (7 nm)',
        'Performance': 'SD 855 ',
        'Ratings': '7/10',
        'Storage': '64GB 6GB RAM, 128GB 6GB RAM',
        'Battery': '2800 mAh',
        'Resolution': '1080 x 2280 pixels, 19:9 ratio (~444 ppi density)',
      }),
  FilterPage(
      id: '50',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=15jxh0S3SslJIEqxRWD3BFuku1x8b60il',
      buyLink: 'https://store.google.com/magazine/compare_pixel',
      color: Colors.red[300],
      name: 'Pixel 4a',
      specs: {
        'Cameras': '12.2 ',
        'Front Camera': '8 MP, f/2.0, 24mm (wide), 1.12µm',
        'Rear Camera':
            '12.2 MP, f/1.7, 27mm (wide), 1/2.55", 1.4µm, dual pixel PDAF, OIS',
        'Display': 'OLED, HDR',
        'Processor': 'Qualcomm SDM730 Snapdragon 730G (8 nm)',
        'Performance': 'SD 730G',
        'Ratings': '7/10',
        'Storage': '128GB 6GB RAM',
        'Battery': '3140 mAh',
        'Resolution': '1080 x 2340 pixels, 19.5:9 ratio (~443 ppi density)',
      }),
  FilterPage(
      id: '51',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1xuJO1iQ8Fm0aexbDkn-YkPov4jTZNFpB',
      buyLink:
          'https://www.flipkart.com/google-pixel-3-xl-not-pink-64-gb/p/itmfefgvxq82gm5g?pid=MOBF9GAPHQ2YT6EA&lid=LSTMOBF9GAPHQ2YT6EA6OKLYM&marketplace=FLIPKART&srno=s_1_2&otracker=search&otracker1=search&fm=SEARCH&iid=3cc99ea3-9902-4c8f-becd-2ca7152adfa1.MOBF9GAPHQ2YT6EA.SEARCH&ppt=sp&ppn=sp&ssid=bnlv5wvwhs0000001599478937522&qH=e9dc3a8fa339db4b',
      color: Colors.blue[700],
      name: 'Pixel 3 XL',
      specs: {
        'Cameras': '12.2 ',
        'Front Camera': '8 MP, f/1.8, 28mm (wide), PDAF' +
            '\n' +
            '8 MP, f/2.2, 19mm (ultrawide), no AF',
        'Rear Camera':
            '12.2 MP, f/1.8, 28mm (wide), 1/2.55", 1.4µm, dual pixel PDAF, OIS',
        'Display': 'P-OLED, HDR',
        'Processor': 'Qualcomm SDM845 Snapdragon 845 (10 nm)',
        'Performance': 'SD 845 ',
        'Ratings': '8/10',
        'Storage': '64GB 4GB RAM, 128GB 4GB RAM',
        'Battery': '3430 mAh',
        'Resolution': '1440 x 2960 pixels, 18.5:9 ratio (~523 ppi density)',
      }),
  FilterPage(
      id: '52',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1W7e3hJjblQf0L0XfddTfY1dk1PDO9OTT',
      buyLink:
          'https://www.flipkart.com/google-pixel-3-clearly-white-64-gb/p/itmfbuyqxkruzg7j?pid=MOBF9GAPM7YHP9PZ&lid=LSTMOBF9GAPM7YHP9PZIQ5GBG&marketplace=FLIPKART&srno=s_1_1&otracker=search&otracker1=search&fm=SEARCH&iid=1a70209c-6a51-4f66-b91e-75e459ae2012.MOBF9GAPM7YHP9PZ.SEARCH&ppt=sp&ppn=sp&ssid=0jiu4l0hgw0000001599478964880&qH=8d95b1037b09443c',
      color: Colors.cyan[400],
      name: 'Pixel 3',
      specs: {
        'Cameras': '12.2 ',
        'Front Camera': '8 MP, f/1.8, 28mm (wide), PDAF' +
            '\n' +
            '8 MP, f/2.2, 19mm (ultrawide), no AF',
        'Rear Camera':
            '12.2 MP, f/1.8, 28mm (wide), 1/2.55", 1.4µm, dual pixel PDAF, OIS',
        'Display': 'P-OLED, HDR',
        'Processor': 'Qualcomm SDM845 Snapdragon 845 (10 nm)',
        'Performance': 'SD 845 ',
        'Ratings': '7/10',
        'Storage': '64GB 4GB RAM, 128GB 4GB RAM',
        'Battery': '2915 mAh',
        'Resolution': '1080 x 2160 pixels, 18:9 ratio (~443 ppi density)',
      }),
  FilterPage(
      id: '53',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1L-1rJEtoHgbizNflfQeEeu13MCtjHy66',
      color: Colors.orange[200],
      name: 'Pixel 3a',
      specs: {
        'Cameras': '12.2 ',
        'Front Camera': '8 MP, f/2.0, 24mm (wide), 1/4", 1.12µm',
        'Rear Camera':
            '12.2 MP, f/1.8, 28mm (wide), 1/2.55", 1.4µm, dual pixel PDAF, OIS',
        'Display': 'OLED ',
        'Processor': 'Qualcomm SDM670 Snapdragon 670 (10 nm)',
        'Performance': 'SD 670 ',
        'Ratings': '4/10',
        'Storage': '64GB 4GB RAM',
        'Battery': '3000 mAh',
        'Resolution': '1080 x 2220 pixels, 18.5:9 ratio (~441 ppi density)',
      }),
  FilterPage(
      id: '54',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1CFPz9kj4iWkmXJhi1JQBHY7NiZtRSO47',
      buyLink:
          'https://www.flipkart.com/google-pixel-3a-clearly-white-64-gb/p/itmfgk4jfgstaack?pid=MOBFFGFPJSCEXMSG&lid=LSTMOBFFGFPJSCEXMSGODGRZE&marketplace=FLIPKART&srno=s_1_1&otracker=search&otracker1=search&fm=SEARCH&iid=9e432777-6b50-4095-bc52-cd3a89db03ea.MOBFFGFPJSCEXMSG.SEARCH&ppt=sp&ppn=sp&ssid=cy8ntf4i8g0000001599479013802&qH=5adb9495cc91f1c5',
      color: Colors.blue[200],
      name: 'Vivo Z1x',
      specs: {
        'Cameras': '48 MP',
        'Front Camera': '32 MP, f/2.0, 26mm (wide), 1/2.8", 0.8µm',
        'Rear Camera': '48 MP, f/1.8, (wide), 1/2.0", 0.8µm, PDAF' +
            '\n' +
            '8 MP, f/2.2, 13mm (ultrawide)' +
            '\n' +
            '2 MP, f/2.4, (depth)',
        'Display': 'Super AMOLED ',
        'Processor': 'Qualcomm SDM712 Snapdragon 712 (10 nm)',
        'Performance': 'SD 712 ',
        'Ratings': '6/10',
        'Storage': '64GB 6GB RAM, 128GB 4GB RAM, 128GB 6GB RAM, 128GB 8GB RAM',
        'Battery': '4500 mAh',
        'Resolution': '1080 x 2340 pixels, 19.5:9 ratio (~404 ppi density)',
      }),
  FilterPage(
      id: '55',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1tr_dwSoJar1zK9qDF1U5NNk3WOfXLoNX',
      buyLink: 'https://amzn.to/3jTpoVp',
      color: Colors.indigo[100],
      name: 'Vivo V19',
      specs: {
        'Cameras': '48 MP',
        'Front Camera': '32 MP, f/2.1, 23mm (wide), 1/2.8", 0.8µm' +
            '\n' +
            '8 MP, f/2.3, 17mm (ultrawide)',
        'Rear Camera': '48 MP, f/1.8, (wide), 1/2.0", 0.8µm, PDAF' +
            '\n' +
            '8 MP, f/2.2, 13mm (ultrawide), 1/4.0", 1.12µm' +
            '\n' +
            '2 MP, f/2.4, (macro)' +
            '\n' +
            '2 MP, f/2.4, (depth)',
        'Display': 'Super AMOLED, HDR10, 1200 nits (peak)',
        'Processor': 'Qualcomm SDM712 Snapdragon 712 (10 nm)',
        'Performance': 'SD 712 ',
        'Ratings': '7/10',
        'Storage': '128GB 8GB RAM, 256GB 8GB RAM',
        'Battery': '4500 mAh',
        'Resolution': '1080 x 2400 pixels, 20:9 ratio (~409 ppi density)',
      }),
  FilterPage(
      id: '56',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1h0wcLPy8eFr9bntARAabQF8elbe8TUEt',
      buyLink: 'https://amzn.to/3271IqC',
      color: Colors.indigo[100],
      name: 'Vivo X50 Pro',
      specs: {
        'Cameras': '48 MP',
        'Front Camera': '32 MP, f/2.5, 26mm (wide), 1/2.8", 0.8µm',
        'Rear Camera': '48 MP, f/1.6, (wide), PDAF, gimbal OIS' +
            '\n' +
            '8 MP, f/3.4, 135mm (periscope telephoto), 1/4.0", PDAF, OIS, 5x optical zoom' +
            '\n' +
            '13 MP, f/2.5, 50mm (portrait), 1/2.8", 0.8µm, PDAF, 2x optical zoom' +
            '\n' +
            '8 MP, f/2.2, 120˚, 16mm (ultrawide), 1/4.0", 1.12µm',
        'Display': 'AMOLED, 90Hz, HDR10+',
        'Processor': 'Qualcomm SDM765 Snapdragon 765G (7 nm)',
        'Performance': 'SD 765G',
        'Ratings': '8/10',
        'Storage': '128GB 8GB RAM, 256GB 8GB RAM',
        'Battery': '4315 mAh',
        'Resolution': '1080 x 2376 pixels (~398 ppi density)',
      }),
  FilterPage(
      id: '57',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=190BUZCT0VXC_krODdR6NNR32L4wEelPl',
      buyLink: 'https://amzn.to/3bxWszi',
      color: Colors.purple[300],
      name: 'Vivo X50',
      specs: {
        'Cameras': '48 MP',
        'Front Camera': '32 MP, f/2.5, 26mm (wide), 1/2.8", 0.8µm',
        'Rear Camera': '48 MP, f/1.6, (wide), PDAF, OIS' +
            '\n' +
            '13 MP, f/2.5, 50mm (portrait), 1/2.8", 0.8µm, PDAF, 2x optical zoom' +
            '\n' +
            '8 MP, f/2.2, 120˚, 16mm (ultrawide), 1/4.0", 1.12µm' +
            '\n' +
            '5 MP, f/2.5, (macro)',
        'Display': 'AMOLED, 90Hz, HDR10+',
        'Processor': 'Qualcomm SDM765 Snapdragon 765G (7 nm)',
        'Performance': 'SD 765G',
        'Ratings': '7/10',
        'Storage': '128GB 8GB RAM, 256GB 8GB RAM',
        'Battery': '4200 mAh',
        'Resolution': '1080 x 2376 pixels (~398 ppi density)',
      }),
  FilterPage(
      id: '58',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1JRxACM_UKkx0OqsHAB1J_j6iHHCqFHRn',
      buyLink:
          'https://www.flipkart.com/poco-c3-matte-black-64-gb/p/itm4e94ab7e418af?pid=MOBFVQJ5KGSJXCKG&lid=LSTMOBFVQJ5KGSJXCKGANFINT&marketplace=FLIPKART&srno=s_1_3&otracker=search&otracker1=search&fm=SEARCH&iid=4c94f463-d079-49e8-92ac-5fe990841730.MOBFVQJ5KGSJXCKG.SEARCH&ppt=sp&ppn=sp&ssid=1od8lqu8uo0000001603711855498&qH=444433ca99f72c33',
      color: Colors.lightBlue[300],
      name: 'POCO C3',
      specs: {
        'Cameras': '13 MP',
        'Front Camera': '5 MP, f/2.2, (wide), 1.12µm',
        'Rear Camera':
            '13 MP, f/2.2, 28mm (wide), 1.0µm, PDAF\n2 MP, f/2.4, (macro)\n2 MP, f/2.4, (depth)',
        'Display': 'IPS LCD, 400 nits (typ)',
        'Processor': 'MediaTek Helio G35 (12 nm)',
        'Performance': 'MT G35',
        'Ratings': '5/10',
        'Storage': '32GB 3GB RAM, 64GB 4GB RAM',
        'Battery': ' 5000 mAh ',
        'Resolution': '720 x 1600 pixels, 20:9 ratio (~270 ppi density)'
      }),
  FilterPage(
      id: '59',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1Yx2riEnSx_VFJ-7pnUTP7SHCF92rqX7B',
      buyLink:
          'https://www.flipkart.com/poco-m2-slate-blue-128-gb/p/itmf3c6e76492ff5?pid=MOBFV9V9XZJJ9NUV&lid=LSTMOBFV9V9XZJJ9NUVJ7C306&marketplace=FLIPKART&srno=s_1_2&otracker=search&otracker1=search&fm=SEARCH&iid=7797cf23-91b1-4804-8bff-a76d973805d3.MOBFV9V9XZJJ9NUV.SEARCH&ppt=sp&ppn=sp&ssid=ezmmuyas0g0000001603711892244&qH=945b7399f0ddc043',
      color: Colors.yellow[400],
      name: 'POCO M2',
      specs: {
        'Cameras': '13 MP',
        'Front Camera': '8 MP, f/2.0, 27mm (wide), 1/4.0", 1.12µm',
        'Rear Camera':
            '13 MP, f/2.2, 28mm (wide), 1/3.1", 1.12µm, PDAF\n8 MP, f/2.2, 118˚ (ultrawide), 1/4.0", 1.12µm\n5 MP, f/2.4, (macro)\n2 MP, f/2.4, (depth)',
        'Display': 'IPS LCD, 400 nits (typ)',
        'Processor': 'Mediatek Helio G80 (12 nm)',
        'Performance': 'MT G80',
        'Ratings': '6/10',
        'Storage': '64GB 6GB RAM, 128GB 6GB RAM',
        'Battery': '5000 mAh',
        'Resolution': '1080 x 2340 pixels, 19.5:9 ratio (~395 ppi density)'
      }),
  FilterPage(
      id: '60',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1NUV0KfrH_LUKx6o0FSrpDPvQ2id1NdVa',
      buyLink:
          'https://www.flipkart.com/poco-m2-pro-out-blue-64-gb/p/itmca92df4f824d5?pid=MOBFT7MKV4EZTNRS&lid=LSTMOBFT7MKV4EZTNRSZ0PYA3&marketplace=FLIPKART&srno=s_1_1&otracker=search&otracker1=search&fm=SEARCH&iid=ac1895ad-647a-4002-ba9d-e17c55d20339.MOBFT7MKV4EZTNRS.SEARCH&ppt=sp&ppn=sp&ssid=mbmfcrxnls0000001599479068204&qH=b83349d0f5338c62',
      color: Colors.red[300],
      name: 'Poco M2 pro',
      specs: {
        'Cameras': '48 MP',
        'Front Camera': '16 MP, f/2.5, (wide), 1/3.06" 1.0µm',
        'Rear Camera': '48 MP, f/1.8, 26mm (wide), 1/2.0", 0.8µm, PDAF' +
            '\n' +
            '8 MP, f/2.2, 119˚ (ultrawide), 1/4.0", 1.12µm' +
            '\n' +
            '5 MP, f/2.4, (macro), AF' +
            '\n' +
            '2 MP, f/2.4, (depth)',
        'Display': 'IPS LCD, HDR10, 450 nits (typ)',
        'Processor': 'Qualcomm SM7125 Snapdragon 720G (8 nm)',
        'Performance': 'SD 720G',
        'Ratings': '6/10',
        'Storage': '64GB 4GB RAM, 64GB 6GB RAM, 128GB 6GB RAM',
        'Battery': '5000 mAh',
        'Resolution': '1080 x 2400 pixels, 20:9 ratio (~395 ppi density)',
      }),
  FilterPage(
      id: '61',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=192z1VldVZs2cudzDuHGc7-Ujxei6RxGU',
      buyLink:
          'https://www.flipkart.com/poco-x3-cobalt-blue-128-gb/p/itm5eabfda5f2dd4?pid=MOBFVQJ5TZTF5JHC&lid=LSTMOBFVQJ5TZTF5JHCO0EDJU&marketplace=FLIPKART&srno=s_1_1&otracker=search&otracker1=search&fm=SEARCH&iid=0ab075c8-5634-42ce-bfcf-05ddf21301bc.MOBFVQJ5TZTF5JHC.SEARCH&ppt=sp&ppn=sp&ssid=qtoj71r8sg0000001603711956947&qH=5a2004e9a5a5938c',
      color: Colors.cyan[300],
      name: 'POCO X3',
      specs: {
        'Cameras': '64 MP',
        'Front Camera': '20 MP, f/2.2, (wide), 1/3.4", 0.8µm',
        'Rear Camera':
            '64 MP, f/1.9, (wide), 1/1.73", 0.8µm, PDAF\n13 MP, f/2.2, 119˚ (ultrawide), 1.0µm\n2 MP, f/2.4, (macro)\n2 MP, f/2.4, (depth)',
        'Display': 'IPS LCD, 120Hz, HDR10, 450 nits (typ)',
        'Processor': 'Qualcomm SM7150-AC Snapdragon 732G (8 nm)',
        'Performance': 'SD 732G',
        'Ratings': '8/10',
        'Storage': '64GB 6GB RAM, 128GB 6GB RAM, 128GB 8GB RAM',
        'Battery': '6000 mAh',
        'Resolution': '1080 x 2400 pixels, 20:9 ratio (~395 ppi density)'
      }),
  FilterPage(
      id: '62',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1PLaZKBQjWawrAh59BPC6ffeBEeLbBJrs',
      buyLink:
          'https://www.flipkart.com/poco-x2-atlantis-blue-64-gb/p/itmbe7b58e0378b8?pid=MOBFZGJ6ZGMD7GEZ&lid=LSTMOBFZGJ6ZGMD7GEZAOQLPQ&marketplace=FLIPKART&srno=s_1_1&otracker=AS_QueryStore_OrganicAutoSuggest_1_5_na_na_ps&otracker1=AS_QueryStore_OrganicAutoSuggest_1_5_na_na_ps&fm=SEARCH&iid=24de6df6-0484-4566-bfc9-9e192eb5c2ee.MOBFZGJ6ZGMD7GEZ.SEARCH&ppt=sp&ppn=sp&ssid=emjizeejkg0000001599479075354&qH=4e0be2db3051d600',
      color: Colors.lightBlue[400],
      name: 'Poco X2',
      specs: {
        'Cameras': '64 MP',
        'Front Camera': '20 MP, f/2.2, 27mm (wide), 1/3.4", 0.8µm' +
            '\n' +
            '2 MP, f/2.4, (depth)',
        'Rear Camera': '64 MP, f/1.9, 26mm (wide), 1/1.72", 0.8µm, PDAF' +
            '\n' +
            '8 MP, f/2.2, 13mm (ultrawide), 1/4.0", 1.12µm' +
            '\n' +
            '2 MP, f/2.4, (macro)' +
            '\n' +
            '2 MP, f/2.4, (depth)',
        'Display': 'IPS LCD, 120Hz, HDR10, 500 nits (typ)',
        'Processor': 'Qualcomm SDM730 Snapdragon 730G (8 nm)',
        'Performance': 'SD 730G',
        'Ratings': '7/10',
        'Storage': '64GB 6GB RAM, 128GB 6GB RAM, 256GB 8GB RAM',
        'Battery': '4500 mAh',
        'Resolution': '1080 x 2400 pixels, 20:9 ratio (~395 ppi density)',
      }),
  FilterPage(
      id: '63',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=18PVUBmWEML47YRDyQK2tRVOOzP49VBWf',
      buyLink:
          'https://www.flipkart.com/motorola-razr-5g-polished-graphite-256-gb/p/itmf4a460fcfa13d?pid=MOBFVH78K4YFAUVG&lid=LSTMOBFVH78K4YFAUVGBMDCOE&marketplace=FLIPKART&srno=s_1_3&otracker=AS_Query_OrganicAutoSuggest_2_13_na_na_ps&otracker1=AS_Query_OrganicAutoSuggest_2_13_na_na_ps&fm=SEARCH&iid=6b57c4a7-01b4-4aad-9e6d-c2dacb2a9263.MOBFVH78K4YFAUVG.SEARCH&ppt=sp&ppn=sp&ssid=i5be6w95lc0000001603712014313&qH=5269cbfc72398e02',
      color: Colors.orange[400],
      name: 'Motorola Razr 5G',
      specs: {
        'Cameras': '16 MP',
        'Front Camera': '5 MP, f/2.0, 1.12um',
        'Rear Camera': '16 MP, f/1.7, 1.22um, Dual Pixel PDAF, Laser AF' +
            '\n' +
            'TOF 3D, (depth)',
        'Display': 'Foldable P-OLED ',
        'Processor': 'Qualcomm SDM710 Snapdragon 710 (10 nm)',
        'Performance': 'SD 710 ',
        'Ratings': '2/10',
        'Storage': '128GB 6GB RAM',
        'Battery': '2510 mAh',
        'Resolution': '876 x 2142 pixels (~373 ppi density)',
      }),
  FilterPage(
      id: '64',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1H4EuhWPgNqOC1cM6vCGbZgWByF1Bi1gp',
      buyLink: 'https://amzn.to/2Zh2YFP',
      color: Colors.pink[200],
      name: 'Motorola Edge Plus',
      specs: {
        'Cameras': '108 M',
        'Front Camera': '25 MP, f/2.0, (wide), 0.9µm',
        'Rear Camera': '108 MP, f/1.8, (wide), 1/1.33", 0.8µm, PDAF, OIS' +
            '\n' +
            '8 MP, f/2.4, 81mm (telephoto), 3x optical zoom, PDAF, OIS' +
            '\n' +
            '16 MP, f/2.2, 13mm (ultrawide), 1.0µm, AF' +
            '\n' +
            'TOF 3D, (depth)',
        'Display': 'OLED, 1B colors, 90Hz, HDR10+',
        'Processor': 'Qualcomm SM8250 Snapdragon 865 (7 nm+)',
        'Performance': 'SD 865 ',
        'Ratings': '8/10',
        'Storage': '256GB 12GB RAM',
        'Battery': '5000 mAh',
        'Resolution': '1080 x 2340 pixels, 19.5:9 ratio (~385 ppi density)',
      }),
  FilterPage(
      id: '65',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1xmBnEEkY9fXQRGckL1Zvx_fGxRxPVwmJ',
      buyLink:
          'https://www.flipkart.com/motorola-g8-power-lite-royal-blue-64-gb/p/itm8a408329ff3d2?pid=MOBFZ5EXNSGJJ2ZR&lid=LSTMOBFZ5EXNSGJJ2ZRBFFMHB&marketplace=FLIPKART&srno=s_1_1&otracker=AS_QueryStore_OrganicAutoSuggest_1_5_na_na_ps&otracker1=AS_QueryStore_OrganicAutoSuggest_1_5_na_na_ps&fm=SEARCH&iid=755c6da5-4ca0-402b-85f2-c1d9f97aea73.MOBFZ5EXNSGJJ2ZR.SEARCH&ppt=sp&ppn=sp&ssid=0klpygchhs0000001599478781700&qH=c7b38449af1e8e16',
      color: Colors.blue[300],
      name: 'Moto G8 Power Lite',
      specs: {
        'Cameras': '16 MP',
        'Front Camera': '8 MP, f/2.0, (wide), 1.12µm',
        'Rear Camera': '16 MP, f/2.0, (wide), 1.0µm, PDAF' +
            '\n' +
            '2 MP, f/2.4, (macro)' +
            '\n' +
            '2 MP, f/2.4, (depth)',
        'Display': 'IPS LCD ',
        'Processor': 'Mediatek MT6765 Helio P35 (12nm)',
        'Performance': 'MT P35',
        'Ratings': '3/10',
        'Storage': '64GB 4GB RAM',
        'Battery': '5000 mAh',
        'Resolution': '720 x 1600 pixels, 20:9 ratio (~269 ppi density)',
      }),
  FilterPage(
      id: '66',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=18-5sdi82xOEZDmVxjxlJtFVXXjFLKGzQ',
      buyLink:
          'https://www.flipkart.com/motorola-g9-sapphire-blue-64-gb/p/itm483cb18471531?pid=MOBFTYWWS6RYZRZH&lid=LSTMOBFTYWWS6RYZRZHHL0ZN0&marketplace=FLIPKART&srno=s_1_1&otracker=search&otracker1=search&fm=SEARCH&iid=2e6cafc6-98f2-499b-a9a9-85ed1d02bd5b.MOBFTYWWS6RYZRZH.SEARCH&ppt=sp&ppn=sp&ssid=r2olgo6p8w0000001599478800914&qH=cfb48860baeafcfa',
      color: Colors.teal[200],
      name: 'Moto G9',
      specs: {
        'Cameras': '48 MP',
        'Front Camera': '8 MP, f/2.2, 1.12µm',
        'Rear Camera': '48 MP, f/1.7, (wide), 1/2.0", 0.8µm, PDAF' +
            '\n' +
            '2 MP, f/2.4, (macro)' +
            '\n' +
            '2 MP, f/2.4, (depth)',
        'Display': 'IPS LCD ',
        'Processor': 'Qualcomm SM6115 Snapdragon 662 (11 nm)',
        'Performance': 'SD 662 ',
        'Ratings': '3/10',
        'Storage': '64GB 4GB RAM',
        'Battery': '5000 mAh',
        'Resolution': '720 x 1600 pixels, 20:9 ratio (~269 ppi density)',
      }),
  FilterPage(
      id: '67',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1SKie3OFHeO6hQv2bklL0WY_6XyDwvgpj',
      buyLink:
          'https://www.flipkart.com/motorola-one-fusion-twilight-blue-128-gb/p/itm9c0e4b9b56acd?pid=MOBFRFXHZRMXDDNZ&lid=LSTMOBFRFXHZRMXDDNZW6P8X2&marketplace=FLIPKART&srno=s_1_1&otracker=AS_QueryStore_OrganicAutoSuggest_1_9_na_na_ps&otracker1=AS_QueryStore_OrganicAutoSuggest_1_9_na_na_ps&fm=SEARCH&iid=e3002294-e23f-4c68-8602-3286442864fe.MOBFRFXHZRMXDDNZ.SEARCH&ppt=sp&ppn=sp&ssid=0d754owxbk0000001599478816188&qH=d8c6069692fd5709',
      color: Colors.blue[300],
      name: 'Moto One fusion plus',
      specs: {
        'Cameras': '64 MP',
        'Front Camera': 'Motorized pop-up 16 MP, f/2.0, (wide), 1/3.06", 1.0µm',
        'Rear Camera': '64 MP, f/1.8, (wide), 1/1.72", 0.8µm, PDAF' +
            '\n' +
            '8 MP, f/2.2, 118˚ (ultrawide), 1/4.0", 1.12µm' +
            '\n' +
            '5 MP, f/2.2, (macro)' +
            '\n' +
            '2 MP, f/2.2, (depth)',
        'Display': 'IPS LCD, HDR10',
        'Processor':
            'Qualcomm SDM730 Snapdragon 730 (8 nm) - EuropeQualcomm SDM730 Snapdragon 730G (8 nm) - India',
        'Performance': 'SD 730 ',
        'Ratings': '4/10',
        'Storage': '128GB 4GB RAM, 128GB 6GB RAM',
        'Battery': '5000 mAh',
        'Resolution': '1080 x 2340 pixels, 19.5:9 ratio (~396 ppi density)',
      }),
  FilterPage(
      id: '68',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1zd4aEr0LGSgvTmKGrkjdwDhIShUKOejh',
      buyLink: 'https://amzn.to/2Tnqgqa',
      color: Colors.black,
      name: 'Samsung Galaxy Fold 2',
      specs: {
        'Cameras': '12 MP',
        'Front Camera': '10 MP, f/2.2, 26mm (wide), 1/3", 1.22µm' +
            '\n' +
            '8 MP, f/1.9, 24mm (wide), 1.22µm, depth sensor' +
            '\n' +
            'Cover camera:' +
            '\n' +
            '10 MP, f/2.2, 26mm (wide), 1/3", 1.22µm',
        'Rear Camera':
            '12 MP, f/1.5-2.4, 27mm (wide), 1/2.55", 1.4µm, Dual Pixel PDAF, OIS' +
                '\n' +
                '12 MP, f/2.4, 52mm (telephoto), 1/3.6", 1.0µm, AF, OIS, 2x optical zoom' +
                '\n' +
                '16 MP, f/2.2, 12mm (ultrawide), 1/3.1", 1.0µm',
        'Display': 'Foldable Dynamic AMOLED, HDR10+',
        'Processor': 'Qualcomm SM8150 Snapdragon 855 (7 nm)',
        'Performance': 'SD 855 ',
        'Ratings': '9/10',
        'Storage': '512GB 12GB RAM',
        'Battery': '4380 mAh',
        'Resolution': '1536 x 2152 pixels (~362 ppi density)',
      }),
  FilterPage(
      id: '69',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1UvlKd0ZRhlE5w3wWmVXJUOGI_o6udHM3',
      buyLink: 'https://amzn.to/3m0GORO',
      color: Colors.purple[200],
      name: 'Samsung Galaxy Z Flip',
      specs: {
        'Cameras': '12 MP',
        'Front Camera': '10 MP, f/2.4, 26mm (wide), 1.22µm',
        'Rear Camera':
            '12 MP, f/1.8, 27mm (wide), 1/2.55", 1.4µm, Dual Pixel PDAF, OIS' +
                '\n' +
                '12 MP, f/2.2, 123˚ (ultrawide), 1.12µm',
        'Display': 'Foldable Dynamic AMOLED, HDR10+',
        'Processor': 'Qualcomm SM8150 Snapdragon 855+ (7 nm)',
        'Performance': 'SD 855+',
        'Ratings': '7/10',
        'Storage': '256GB 8GB RAM',
        'Battery': '3300 mAh',
        'Resolution': '1080 x 2636 pixels (~425 ppi density)',
      }),
  FilterPage(
      id: '70',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1cuIOt2F9FbyaiOotAV9-lxns7WaV6M6I',
      buyLink: 'https://amzn.to/3jQSN2A',
      color: Colors.black,
      name: 'Samsung Note 20 Ultra',
      specs: {
        'Cameras': '108 M',
        'Front Camera':
            '10 MP, f/2.2, 26mm (wide), 1/3.2", 1.22µm, Dual Pixel PDAF',
        'Rear Camera':
            '108 MP, f/1.8, 26mm (wide), 1/1.33", 0.8µm, PDAF, Laser AF, OIS' +
                '\n' +
                '12 MP, f/3.0, 120mm (periscope telephoto), 1.0µm, PDAF, OIS, 5x optical zoom, 50x hybrid zoom' +
                '\n' +
                '12 MP, f/2.2, 120˚, 13mm (ultrawide), 1/2.55", 1.4µm',
        'Display': 'Dynamic AMOLED 2X, 120Hz, HDR10+',
        'Processor':
            'Exynos 990 (7 nm+) - GlobalQualcomm SM8250 Snapdragon 865+ (7 nm+) - USA',
        'Performance': 'Exynos 990 ',
        'Ratings': '10/10',
        'Storage': '128GB 12GB RAM, 256GB 12GB RAM, 512GB 12GB RAM',
        'Battery': '4500 mAh',
        'Resolution': '1440 x 3088 pixels (~496 ppi density)',
      }),
  FilterPage(
      id: '71',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=14A9PN2Jgrhwhh4h2m_sxTwEvH1fgZVjr',
      buyLink: 'https://amzn.to/334jPwF',
      color: Colors.grey[400],
      name: 'Samsung Note 20',
      specs: {
        'Cameras': '12 MP',
        'Front Camera':
            '10 MP, f/2.2, 26mm (wide), 1/3.2", 1.22µm, Dual Pixel PDAF',
        'Rear Camera':
            '12 MP, f/1.8, 26mm (wide), 1/1.76", 1.8µm, Dual Pixel PDAF, OIS' +
                '\n' +
                '64 MP, f/2.0, 27mm (telephoto), 1/1.72", 0.8µm, PDAF, OIS, 3x hybrid zoom' +
                '\n' +
                '12 MP, f/2.2, 120˚, 13mm (ultrawide), 1/2.55", 1.4µm',
        'Display': 'Super AMOLED Plus, HDR10+',
        'Processor':
            'Exynos 990 (7 nm+) - GlobalQualcomm SM8250 Snapdragon 865+ (7 nm+) - USA',
        'Performance': 'Exynos 990 ',
        'Ratings': '9/10',
        'Storage': '128GB 8GB RAM, 256GB 8GB RAM',
        'Battery': '4300 mAh',
        'Resolution': '1080 x 2400 pixels, 20:9 ratio (~393 ppi density)',
      }),
  FilterPage(
      id: '72',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1Oa10oSw2KpSZ4ry1_qrFUKc6jxAYjkDo',
      buyLink: 'https://amzn.to/3k6urCj',
      color: Colors.lightBlue[300],
      name: 'Samsung S20 Ultra',
      specs: {
        'Cameras': '108 M',
        'Front Camera': '40 MP, f/2.2, 26mm (wide), 0.7µm, PDAF',
        'Rear Camera': '108 MP, f/1.8, 26mm (wide), 1/1.33", 0.8µm, PDAF, OIS' +
            '\n' +
            '48 MP, f/3.5, 103mm (periscope telephoto), 1/2.0", 0.8µm, PDAF, OIS, 4x optical zoom, 10x hybrid zoom' +
            '\n' +
            '12 MP, f/2.2, 13mm (ultrawide), 1.4µm, Super Steady video' +
            '\n' +
            '0.3 MP, TOF 3D, f/1.0, (depth)',
        'Display': 'Dynamic AMOLED 2X, 120Hz, HDR10+',
        'Processor':
            'Exynos 990 (7 nm+) - GlobalQualcomm SM8250 Snapdragon 865 (7 nm+) - USA',
        'Performance': 'Exynos 990 ',
        'Ratings': '10/10',
        'Storage': '128GB 12GB RAM, 256GB 12GB RAM, 512GB 16GB RAM',
        'Battery': '5000 mAh',
        'Resolution': '1440 x 3200 pixels, 20:9 ratio (~511 ppi density)',
      }),
  FilterPage(
      id: '73',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1LXC8p3u6KddigqZ2Fil-pnDvrw8wKi3Z',
      buyLink: 'https://amzn.to/325FmWr',
      color: Colors.indigo[400],
      name: 'Samsung S20 Plus',
      specs: {
        'Cameras': '12 MP',
        'Front Camera':
            '10 MP, f/2.2, 26mm (wide), 1/3.2", 1.22µm, Dual Pixel PDAF',
        'Rear Camera':
            '12 MP, f/1.8, 26mm (wide), 1/1.76", 1.8µm, Dual Pixel PDAF, OIS' +
                '\n' +
                '64 MP, f/2.0, 29mm (telephoto), 1/1.72", 0.8µm, PDAF, OIS, 1.1x optical zoom, 3x hybrid zoom' +
                '\n' +
                '12 MP, f/2.2, 13mm (ultrawide), 1.4µm, Super Steady video' +
                '\n' +
                '0.3 MP, TOF 3D, f/1.0, (depth)',
        'Display': 'Dynamic AMOLED 2X, 120Hz, HDR10+',
        'Processor':
            'Exynos 990 (7 nm+) - GlobalQualcomm SM8250 Snapdragon 865 (7 nm+) - USA',
        'Performance': 'Exynos 990 ',
        'Ratings': '10/10',
        'Storage': '128GB 8GB RAM',
        'Battery': '4500 mAh',
        'Resolution': '1440 x 3200 pixels, 20:9 ratio (~525 ppi density)',
      }),
  FilterPage(
      id: '74',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1NiNLDWz1BVbRvsVycvUNum1DtdgH39jO',
      buyLink: 'https://amzn.to/35bwQHl',
      color: Colors.red[400],
      name: 'Samsung S20',
      specs: {
        'Cameras': '12 MP',
        'Front Camera':
            '10 MP, f/2.2, 26mm (wide), 1/3.2", 1.22µm, Dual Pixel PDAF',
        'Rear Camera':
            '12 MP, f/1.8, 26mm (wide), 1/1.76", 1.8µm, Dual Pixel PDAF, OIS' +
                '\n' +
                '64 MP, f/2.0, 29mm (telephoto), 1/1.72", 0.8µm, PDAF, OIS, 1.1x optical zoom, 3x hybrid zoom' +
                '\n' +
                '12 MP, f/2.2, 13mm (ultrawide), 1.4µm, Super Steady video',
        'Display': 'Dynamic AMOLED 2X, 120Hz, HDR10+',
        'Processor':
            'Exynos 990 (7 nm+) - GlobalQualcomm SM8250 Snapdragon 865 (7 nm+) - USA',
        'Performance': 'Exynos 990 ',
        'Ratings': '9/10',
        'Storage': '128GB 8GB RAM',
        'Battery': '4000 mAh',
        'Resolution': '1440 x 3200 pixels, 20:9 ratio (~563 ppi density)',
      }),
  FilterPage(
      id: '75',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1hvVC5Tenh_3VSAE2ErG6WHWOGMUUIMF9',
      buyLink: 'https://amzn.to/2HzCLwB',
      color: Colors.red[300],
      name: 'Samsung Galaxy S20 FE',
      specs: {
        'Cameras': '12 MP',
        'Front Camera': '32 MP, f/2.2, 26mm (wide), 1/2.74", 0.8µm',
        'Rear Camera':
            '12 MP, f/1.8, 26mm (wide), 1/1.76", 1.8µm, Dual Pixel PDAF, OIS\n8 MP, f/2.4, 76mm (telephoto), 1/4.5", 1.0µm, PDAF, OIS, 3x optical zoom\n12 MP, f/2.2, 123˚, 13mm (ultrawide), 1/3.0", 1.12µm',
        'Display': 'Super AMOLED, 120Hz, HDR10+',
        'Processor': 'Exynos 990 (7 nm+)',
        'Performance': 'Exynos 990',
        'Ratings': '10/10',
        'Storage': '128GB 6GB RAM, 128GB 8GB RAM, 256GB 8GB RAM',
        'Battery': '4500 mAh',
        'Resolution': '1080 x 2400 pixels, 20:9 ratio (~407 ppi density)'
      }),
  FilterPage(
      id: '76',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1ALRXFD0pjAvdgG55JJ1ZBysrHI-hQOpI',
      buyLink:
          'https://www.flipkart.com/samsung-galaxy-note-10-plus-aura-glow-256-gb/p/itm89ffb43fc7a18?pid=MOBFJFWVVMDNSFCF&lid=LSTMOBFJFWVVMDNSFCFUCSPAP&marketplace=FLIPKART&srno=s_1_1&otracker=search&otracker1=search&fm=SEARCH&iid=4529ec9d-3a6e-4aee-a998-4b0597a8ac72.MOBFJFWVVMDNSFCF.SEARCH&ppt=sp&ppn=sp&ssid=pod5ffqyz40000001599477308614&qH=6968ac67a8722c62',
      color: Colors.indigo[100],
      name: 'Samsung Note 10 Plus',
      specs: {
        'Cameras': '12 MP',
        'Front Camera':
            '10 MP, f/2.2, 26mm (wide), 1/3", 1.22µm, Dual Pixel PDAF',
        'Rear Camera':
            '12 MP, f/1.5-2.4, 27mm (wide), 1/2.55", 1.4µm, Dual Pixel PDAF, OIS' +
                '\n' +
                '12 MP, f/2.1, 52mm (telephoto), 1/3.6", 1.0µm, PDAF, OIS, 2x optical zoom' +
                '\n' +
                '16 MP, f/2.2, 12mm (ultrawide), 1/3.1", 1.0µm, Super Steady video' +
                '\n' +
                '0.3 MP, TOF 3D, (depth)',
        'Display': 'Dynamic AMOLED, HDR10+',
        'Processor':
            'Exynos 9825 (7 nm) - EMEA/LATAMQualcomm SM8150 Snapdragon 855 (7 nm) - USA/China',
        'Performance': 'Exynos 9825',
        'Ratings': '9/10',
        'Storage': '256GB 12GB RAM, 512GB 12GB RAM',
        'Battery': '4300 mAh',
        'Resolution': '1440 x 3040 pixels, 19:9 ratio (~498 ppi density)',
      }),
  FilterPage(
      id: '77',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1i3jw9lBS7uryi9HfvyfzC6G-aSSlXokc',
      buyLink: 'https://amzn.to/3lVuXod',
      color: Colors.indigo[100],
      name: 'Samsung Note 10',
      specs: {
        'Cameras': '12 MP',
        'Front Camera':
            '10 MP, f/2.2, 26mm (wide), 1/3", 1.22µm, Dual Pixel PDAF',
        'Rear Camera':
            '12 MP, f/1.5-2.4, 27mm (wide), 1/2.55", 1.4µm, Dual Pixel PDAF, OIS' +
                '\n' +
                '12 MP, f/2.1, 52mm (telephoto), 1/3.6", 1.0µm, PDAF, OIS, 2x optical zoom' +
                '\n' +
                '16 MP, f/2.2, 12mm (ultrawide), 1/3.1", 1.0µm, Super Steady video',
        'Display': 'Dynamic AMOLED, HDR10+',
        'Processor':
            'Exynos 9825 (7 nm) - EMEA/LATAMQualcomm SM8150 Snapdragon 855 (7 nm) - USA/China',
        'Performance': 'Exynos 9825',
        'Ratings': '9/10',
        'Storage': '256GB 8GB RAM',
        'Battery': '3500 mAh',
        'Resolution': '1080 x 2280 pixels, 19:9 ratio (~401 ppi density)',
      }),
  FilterPage(
      id: '78',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1gNrpnpjpQWWb-bnajodV9oCb5q_YXHvu',
      buyLink: 'https://amzn.to/2R07J1R',
      color: Colors.indigo[300],
      name: 'Samsung S10 Plus',
      specs: {
        'Cameras': '12 MP',
        'Front Camera':
            '10 MP, f/1.9, 26mm (wide), 1/3", 1.22µm, Dual Pixel PDAF' +
                '\n' +
                '8 MP, f/2.2, 22mm (wide), 1/4", 1.12µm, depth sensor',
        'Rear Camera':
            '12 MP, f/1.5-2.4, 26mm (wide), 1/2.55", 1.4µm, Dual Pixel PDAF, OIS' +
                '\n' +
                '12 MP, f/2.4, 52mm (telephoto), 1/3.6", 1.0µm, AF, OIS, 2x optical zoom' +
                '\n' +
                '16 MP, f/2.2, 12mm (ultrawide), 1/3.1", 1.0µm, Super Steady video',
        'Display': 'Dynamic AMOLED, HDR10+',
        'Processor':
            'Exynos 9820 (8 nm) - EMEA/LATAMQualcomm SM8150 Snapdragon 855 (7 nm) - USA/China',
        'Performance': 'Exynos 9820',
        'Ratings': '9/10',
        'Storage': '128GB 8GB RAM, 512GB 8GB RAM, 1TB 12GB RAM',
        'Battery': '4100 mAh',
        'Resolution': '1440 x 3040 pixels, 19:9 ratio (~522 ppi density)',
      }),
  FilterPage(
      id: '79',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1hbXPQeMgXeamW0SimvJFuT9-eQnN17s_',
      buyLink: 'https://amzn.to/2GuDs9s',
      color: Colors.blue[200],
      name: 'Samsung S10',
      specs: {
        'Cameras': '12 MP',
        'Front Camera':
            '10 MP, f/1.9, 26mm (wide), 1/3", 1.22µm, Dual Pixel PDAF',
        'Rear Camera':
            '12 MP, f/1.5-2.4, 26mm (wide), 1/2.55", 1.4µm, Dual Pixel PDAF, OIS' +
                '\n' +
                '12 MP, f/2.4, 52mm (telephoto), 1/3.6", 1.0µm, AF, OIS, 2x optical zoom' +
                '\n' +
                '16 MP, f/2.2, 12mm (ultrawide), 1/3.1", 1.0µm, Super Steady video',
        'Display': 'Dynamic AMOLED, HDR10+',
        'Processor':
            'Exynos 9820 (8 nm) - EMEA/LATAMQualcomm SM8150 Snapdragon 855 (7 nm) - USA/China',
        'Performance': 'Exynos 9820',
        'Ratings': '9/10',
        'Storage': '128GB 8GB RAM, 512GB 8GB RAM',
        'Battery': '3400 mAh',
        'Resolution': '1440 x 3040 pixels, 19:9 ratio (~550 ppi density)',
      }),
  FilterPage(
      id: '80',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1g-4MN3BvbewgnhRSm64pjV0-vSNLlITk',
      buyLink: 'https://amzn.to/32Yntbe',
      color: Colors.cyan[200],
      name: 'Samsung Note 10 Lite',
      specs: {
        'Cameras': '12 MP',
        'Front Camera': '32 MP, f/2.2, 25mm (wide), 1/2.8", 0.8µm',
        'Rear Camera':
            '12 MP, f/1.7, 27mm (wide), 1/2.55", 1.4µm, Dual Pixel PDAF, OIS' +
                '\n' +
                '12 MP, f/2.4, 52mm (telephoto), 1/3.6", 1.0µm, PDAF, OIS, 2x optical zoom' +
                '\n' +
                '12 MP, f/2.2, 12mm (ultrawide)',
        'Display': 'Super AMOLED, HDR',
        'Processor': 'Exynos 9810 (10 nm)',
        'Performance': 'Exynos 9810',
        'Ratings': '9/10',
        'Storage': '128GB 6GB RAM, 128GB 8GB RAM',
        'Battery': '4500 mAh',
        'Resolution': '1080 x 2400 pixels, 20:9 ratio (~394 ppi density)',
      }),
  FilterPage(
      id: '81',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1zm-NDK12SkF57U27m309Gm7Xu2SkAVPt',
      buyLink:
          'https://www.flipkart.com/samsung-galaxy-s10-lite-prism-black-128-gb/p/itm284b16d93b2f1?pid=MOBFZ8HTN4F7HHSV&lid=LSTMOBFZ8HTN4F7HHSVBUHMR2&marketplace=FLIPKART&srno=s_1_1&otracker=AS_QueryStore_OrganicAutoSuggest_1_5_na_na_na&otracker1=AS_QueryStore_OrganicAutoSuggest_1_5_na_na_na&fm=SEARCH&iid=35551027-8202-45d4-bf86-d7002c9ad0f8.MOBFZ8HTN4F7HHSV.SEARCH&ppt=sp&ppn=sp&ssid=apvp579t9s0000001599476848821&qH=fa606bef6e177940',
      color: Colors.orange[400],
      name: 'Samsung S10 Lite',
      specs: {
        'Cameras': '48 MP',
        'Front Camera': '32 MP, f/2.2, 25mm (wide), 1/2.8", 0.8µm',
        'Rear Camera':
            '48 MP, f/2.0, 26mm (wide), 1/2.0", 0.8µm, PDAF, Super Steady OIS' +
                '\n' +
                '12 MP, f/2.2, 12mm (ultrawide)' +
                '\n' +
                '5 MP, f/2.4, (macro)',
        'Display': 'Super AMOLED Plus, HDR10+',
        'Processor': 'Qualcomm SM8150 Snapdragon 855 (7 nm)',
        'Performance': 'SD 855 ',
        'Ratings': '9/10',
        'Storage': '128GB 6GB RAM, 128GB 8GB RAM, 512GB 8GB RAM',
        'Battery': '4500 mAh',
        'Resolution': '1080 x 2400 pixels, 20:9 ratio (~394 ppi density)',
      }),
  FilterPage(
      id: '82',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1fRrR3ZoykJj8z6eEZqF0eBRGy1E_Fd8Z',
      buyLink: 'https://amzn.to/35eJ1mH',
      color: Colors.lightGreen[400],
      name: 'Samsung Galaxy M31S',
      specs: {
        'Cameras': '64 MP',
        'Front Camera': '32 MP, f/2.2, 26mm (wide), 1/2.8", 0.8µm',
        'Rear Camera': '64 MP, f/1.8, 26mm (wide), 1/1.72", 0.8µm, PDAF' +
            '\n' +
            '12 MP, f/2.2, 123˚ (ultrawide)' +
            '\n' +
            '5 MP, f/2.4, (macro)' +
            '\n' +
            '5 MP, f/2.4, (depth)',
        'Display': 'Super AMOLED ',
        'Processor': 'Exynos 9611 (10nm)',
        'Performance': 'Exynos 9611',
        'Ratings': '8/10',
        'Storage': '128GB 6GB RAM, 128GB 8GB RAM',
        'Battery': '6000 mAh',
        'Resolution': '1080 x 2400 pixels, 20:9 ratio (~405 ppi density)',
      }),
  FilterPage(
      id: '83',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1xAiBLvYAVu2xagCxTIlHDLXMSqpR3-Vv',
      buyLink: 'https://amzn.to/37JmboO',
      color: Colors.orange[300],
      name: 'Samsung Galaxy M01s',
      specs: {
        'Cameras': '13 MP',
        'Front Camera': '8 MP, f/2.0',
        'Rear Camera':
            '13 MP, f/1.8, 28mm (wide), 1/3.1", 1.12µm, AF\n2 MP, f/2.4, (depth)',
        'Display': 'PLS TFT',
        'Processor': 'Mediatek MT6762 Helio P22 (12 nm)',
        'Performance': 'MT P22',
        'Ratings': '0/10',
        'Storage': '32GB 3GB RAM',
        'Battery': '4000 mAh',
        'Resolution': '720 x 1520 pixels, 19:9 ratio (~271 ppi density)'
      }),
  FilterPage(
      id: '84',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=13HLe7FCTC4088rxUsT1Seqhnem1Gv7U9',
      buyLink: 'https://amzn.to/3lYHfME',
      color: Colors.cyan[300],
      name: 'Samsung Galaxy M01',
      specs: {
        'Cameras': '13 MP',
        'Front Camera': '5 MP, f/2.2, 1/5", 1.12µm',
        'Rear Camera': '13 MP, f/2.2, 28mm (wide), 1/3.1", 1.12µm, AF' +
            '\n' +
            '2 MP, f/2.4, (depth)',
        'Display': 'PLS TFT ',
        'Processor': 'Qualcomm SDM439 Snapdragon 439 (12 nm)',
        'Performance': 'SD 439 ',
        'Ratings': '2/10',
        'Storage': '32GB 3GB RAM',
        'Battery': '4000 mAh',
        'Resolution': '720 x 1520 pixels, 19:9 ratio (~294 ppi density)',
      }),
  FilterPage(
      id: '85',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1tz2HrDgbq9cAM3HDiHDG-9TyjVkrHlUF',
      buyLink: 'https://amzn.to/3398FXH',
      color: Colors.purple[200],
      name: 'Samsung Galaxy M11',
      specs: {
        'Cameras': '13 MP',
        'Front Camera': '8 MP, f/2.0, (wide)',
        'Rear Camera': '13 MP, f/1.8, 27mm (wide), 1/3.1", 1.12µm, PDAF' +
            '\n' +
            '5 MP, f/2.2, 14mm (ultrawide)' +
            '\n' +
            '2 MP, f/2.4, (depth)',
        'Display': 'PLS TFT ',
        'Processor': 'Qualcomm SDM450 Snapdragon 450 (14 nm)',
        'Performance': 'SD 450 ',
        'Ratings': '2/10',
        'Storage': '32GB 3GB RAM, 64GB 4GB RAM',
        'Battery': '5000 mAh',
        'Resolution': '720 x 1560 pixels, 19.5:9 ratio (~268 ppi density)',
      }),
  FilterPage(
      id: '86',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1Z2UYlvW9HVnZJeYe3W0fGaWceo62K6Y5',
      buyLink:
          'https://www.flipkart.com/samsung-galaxy-f41-fusion-blue-128-gb/p/itm4769d0667cdf9?pid=MOBFV5PWG5MGD4CF&lid=LSTMOBFV5PWG5MGD4CFZ8YQJZ&marketplace=FLIPKART&srno=s_1_1&otracker=AS_QueryStore_OrganicAutoSuggest_2_3_na_na_ps&otracker1=AS_QueryStore_OrganicAutoSuggest_2_3_na_na_ps&fm=SEARCH&iid=c5cc256d-a41d-4e79-9ac8-058d1d33bfe6.MOBFV5PWG5MGD4CF.SEARCH&ppt=sp&ppn=sp&ssid=784pval2ow0000001603712361677&qH=1227c71ef6f8ec47',
      color: Colors.cyan[300],
      name: 'Samsung Galaxy F41',
      specs: {
        'Cameras': '64 MP',
        'Front Camera': '32 MP, f/2.0, 26mm (wide), 1/2.8", 0.8µm',
        'Rear Camera':
            '64 MP, f/1.8, 26mm (wide), 1/1.72", 0.8µm, PDAF\n8 MP, f/2.2, 123˚ (ultrawide), 1/4.0", 1.12µm\n5 MP, f/2.4, (depth)',
        'Display': 'Super AMOLED, 420 nits (peak)',
        'Processor': 'Exynos 9611 (10nm)',
        'Performance': 'Exynos 9611',
        'Ratings': '7/10',
        'Storage': '64GB 6GB RAM, 128GB 6GB RAM',
        'Battery': '6000 mAh',
        'Resolution': '1080 x 2340 pixels, 19.5:9 ratio (~403 ppi density)'
      }),
  FilterPage(
      id: '87',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1q98K2pLGeF9OAHjMQm-XegZDkKdPu8il',
      buyLink: 'https://amzn.to/34twBqs',
      color: Colors.green[400],
      name: 'Samsung Galaxy M51',
      specs: {
        'Cameras': '64 MP',
        'Front Camera': '32 MP, f/2.0, 26mm (wide), 1/2.8", 0.8µm',
        'Rear Camera':
            '64 MP, f/1.8, 26mm (wide), 1/1.73", 0.8µm, PDAF\n12 MP, f/2.2, 123˚ (ultrawide)\n5 MP, f/2.4, (macro)\n5 MP, f/2.4, (depth)',
        'Display': 'Super AMOLED Plus',
        'Processor': 'Qualcomm SDM730 Snapdragon 730G (8 nm)',
        'Performance': 'SD 730G',
        'Ratings': '8/10',
        'Storage': '128GB 6GB RAM, 128GB 8GB RAM',
        'Battery': '7000 mAh',
        'Resolution': '1080 x 2400 pixels, 20:9 ratio (~393 ppi density)'
      }),
  FilterPage(
      id: '88',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=10DfSKGarOuZHJ3LUjKD5mL4Nc0uSijl3',
      buyLink: 'https://amzn.to/3ibOWg8',
      color: Colors.teal[200],
      name: 'Samsung Galaxy M31',
      specs: {
        'Cameras': '64 MP',
        'Front Camera': '32 MP, f/2.0, 26mm (wide), 1/2.8", 0.8µm',
        'Rear Camera': '64 MP, f/1.8, 26mm (wide), 1/1.72", 0.8µm, PDAF' +
            '\n' +
            '8 MP, f/2.2, 12mm (ultrawide), 1/4.0", 1.12µm' +
            '\n' +
            '5 MP, f/2.4, (macro)' +
            '\n' +
            '5 MP, f/2.2, (depth)',
        'Display': 'Super AMOLED ',
        'Processor': 'Exynos 9611 (10nm)',
        'Performance': 'Exynos 9611',
        'Ratings': '6/10',
        'Storage': '64GB 6GB RAM, 128GB 6GB RAM, 128GB 8GB RAM',
        'Battery': '6000 mAh',
        'Resolution': '1080 x 2340 pixels, 19.5:9 ratio (~403 ppi density)',
      }),
  FilterPage(
      id: '89',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1jdDdlbaOWrCUH-eo2E4C243wbTsQCBuj',
      buyLink: 'https://amzn.to/3ibOWg8',
      color: Colors.blue[200],
      name: 'Samsung Galaxy M21',
      specs: {
        'Cameras': '48 MP',
        'Front Camera': '20 MP, f/2.0, 26mm (wide)',
        'Rear Camera': '48 MP, f/2.0, 26mm (wide), 1/2.0", 0.8µm, PDAF' +
            '\n' +
            '8 MP, f/2.2, 12mm (ultrawide), 1/4.0", 1.12µm' +
            '\n' +
            '5 MP, f/2.2, (depth)',
        'Display': 'Super AMOLED, 420 nits (typ)',
        'Processor': 'Exynos 9611 (10nm)',
        'Performance': 'Exynos 9611',
        'Ratings': '6/10',
        'Storage': '64GB 4GB RAM, 128GB 6GB RAM',
        'Battery': '6000 mAh',
        'Resolution': '1080 x 2340 pixels, 19.5:9 ratio (~403 ppi density)',
      }),
  FilterPage(
      id: '90',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=17A0PzGPStGmUXg_CPNWw_RnaPlKDM2cT',
      buyLink: 'https://amzn.to/2ZeQFK4',
      color: Colors.blue[400],
      name: 'Samsung Galaxy A21S',
      specs: {
        'Cameras': '48 MP',
        'Front Camera': '13 MP, f/2.2, (wide), 1/3.1", 1.12µm',
        'Rear Camera': '48 MP, f/2.0, 26mm (wide), 1/2.0", 0.8µm, PDAF' +
            '\n' +
            '8 MP, f/2.2, 123˚ (ultrawide), 1/4.0", 1.12µm' +
            '\n' +
            '2 MP, f/2.4, (macro)' +
            '\n' +
            '2 MP, f/2.4, (depth)',
        'Display': 'PLS TFT ',
        'Processor': 'Exynos 850 (8nm)',
        'Performance': 'Exynos 850 ',
        'Ratings': '3/10',
        'Storage': '32GB 2GB RAM, 32GB 3GB RAM, 64GB 4GB RAM, 64GB 6GB RAM',
        'Battery': '5000 mAh',
        'Resolution': '720 x 1600 pixels, 20:9 ratio (~270 ppi density)',
      }),
  FilterPage(
      id: '91',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1z8xCCcJihMLdZ4SVhvg4GVv93K5albtY',
      buyLink: 'https://amzn.to/339nBos',
      color: Colors.orange[400],
      name: 'Samsung Galaxy A31',
      specs: {
        'Cameras': '48 MP',
        'Front Camera': '20 MP, f/2.2, (wide)',
        'Rear Camera': '48 MP, f/2.0, 26mm (wide), 1/2.0", 0.8µm, PDAF' +
            '\n' +
            '8 MP, f/2.2, 123˚, (ultrawide), 1/4.0", 1.12µm' +
            '\n' +
            '5 MP, f/2.4, (macro)' +
            '\n' +
            '5 MP, f/2.4, (depth)',
        'Display': 'Super AMOLED ',
        'Processor': 'Mediatek MT6768 Helio P65 (12nm)',
        'Performance': 'MT P65',
        'Ratings': '3/10',
        'Storage': '64GB 4GB RAM, 128GB 4GB RAM, 128GB 6GB RAM',
        'Battery': '5000 mAh',
        'Resolution': '1080 x 2400 pixels, 20:9 ratio (~411 ppi density)',
      }),
  FilterPage(
      id: '92',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1rAfouR83ESXtOpLvJZ_KkKWg3NTfM1OH',
      buyLink: 'https://amzn.to/3lUq1zY',
      color: Colors.yellow,
      name: 'Samsung Galaxy A51',
      specs: {
        'Cameras': '48 MP',
        'Front Camera': '32 MP, f/2.2, 26mm (wide), 1/2.8", 0.8µm',
        'Rear Camera': '48 MP, f/2.0, 26mm (wide), 1/2.0", 0.8µm, PDAF' +
            '\n' +
            '12 MP, f/2.2, 123˚ (ultrawide)' +
            '\n' +
            '5 MP, f/2.4, (macro)' +
            '\n' +
            '5 MP, f/2.2, (depth)',
        'Display': 'Super AMOLED ',
        'Processor': 'Exynos 9611 (10nm)',
        'Performance': 'Exynos 9611',
        'Ratings': '3/10',
        'Storage': '64GB 4GB RAM, 128GB 4GB RAM, 128GB 6GB RAM, 128GB 8GB RAM',
        'Battery': '4000 mAh',
        'Resolution': '1080 x 2400 pixels, 20:9 ratio (~405 ppi density)',
      }),
  FilterPage(
      id: '93',
      isFav: false,
      imageUrl:
          'https://drive.google.com/uc?export=view&id=1fFd5bxQLcfo3QLzkhjRwASRk72BfdXeM',
      buyLink: 'https://amzn.to/2F6Md9l',
      color: Colors.red,
      name: 'Samsung Galaxy A71',
      specs: {
        'Cameras': '64 MP',
        'Front Camera': '32 MP, f/2.2, 26mm (wide), 1/2.8", 0.8µm',
        'Rear Camera': '64 MP, f/1.8, 26mm (wide), 1/1.72", 0.8µm, PDAF' +
            '\n' +
            '12 MP, f/2.2, 123˚ (ultrawide)' +
            '\n' +
            '5 MP, f/2.4, (macro)' +
            '\n' +
            '5 MP, f/2.2, (depth)',
        'Display': 'Super AMOLED Plus ',
        'Processor':
            'Qualcomm SDM730 Snapdragon 730 (8 nm) - GlobalQualcomm SDM730 Snapdragon 730G (8 nm) - Philippines',
        'Performance': 'SD 730 ',
        'Ratings': '7/10',
        'Storage': '128GB 6GB RAM, 128GB 8GB RAM',
        'Battery': '4500 mAh',
        'Resolution': '1080 x 2400 pixels, 20:9 ratio (~393 ppi density)',
      }),
];
