import 'dart:math';

class WebMLService {
  // Simple rule-based recommendation system for web compatibility
  // This replaces the TensorFlow Lite functionality
  
  static Future<int> predictBrand(List<List<double>> input, double flagChinese, List<String> labels, List<String> labelsncp) async {
    // Simulate ML prediction with rule-based logic
    await Future.delayed(Duration(milliseconds: 500)); // Simulate processing time
    
    
    // Simple rule-based prediction based on price and features
    var inputData = input[0];
    var priceIndex = -1;
    
    // Find price range
    for (int i = 0; i < 12; i++) {
      if (inputData[i] == 1) {
        priceIndex = i + 1;
        break;
      }
    }
    
    var performance = inputData[12];
    var camera = inputData[13];
    
    int brandIndex = 0;
    
    if (flagChinese == 1) {
      // Chinese brands allowed
      if (priceIndex <= 3) { // Budget phones
        if (performance >= 1) brandIndex = 0; // MI
        else if (camera >= 1) brandIndex = 2; // Realme
        else brandIndex = 7; // POCO
      } else if (priceIndex <= 6) { // Mid-range
        if (performance >= 2) brandIndex = 4; // OnePlus
        else if (camera >= 2) brandIndex = 1; // OPPO
        else brandIndex = 2; // Realme
      } else { // Premium
        if (camera >= 3) brandIndex = 5; // Apple
        else if (performance >= 2) brandIndex = 4; // OnePlus
        else brandIndex = 8; // Samsung
      }
    } else {
      // Non-Chinese brands only
      if (priceIndex <= 6) { // Budget to mid-range
        brandIndex = 3; // Samsung (index in labelsncp)
      } else { // Premium
        if (camera >= 3) brandIndex = 1; // Apple
        else brandIndex = 3; // Samsung
      }
    }
    
    // Add some randomness
    var random = Random();
    if (random.nextDouble() < 0.3) {
      if (flagChinese == 1) {
        brandIndex = random.nextInt(labels.length);
      } else {
        brandIndex = random.nextInt(labelsncp.length);
      }
    }
    
    return brandIndex;
  }
}