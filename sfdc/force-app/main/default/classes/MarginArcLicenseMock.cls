@isTest
public class MarginArcLicenseMock implements HttpCalloutMock {
  private Integer statusCode;
  private String responseBody;
  private String endpoint;

  public MarginArcLicenseMock(
    String endpoint,
    Integer statusCode,
    String responseBody
  ) {
    this.endpoint = endpoint;
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }

  public HttpResponse respond(HttpRequest req) {
    HttpResponse res = new HttpResponse();
    res.setHeader('Content-Type', 'application/json');
    res.setStatusCode(this.statusCode);
    res.setBody(this.responseBody);
    return res;
  }

  // Factory methods for common responses

  public static MarginArcLicenseMock successActivation() {
    Map<String, Object> config = new Map<String, Object>{
      'customer_id' => 'test-uuid-12345',
      'seats_licensed' => 50,
      'expiry_date' => '2027-02-11',
      'gemini_api_key' => 'AIza_test_key_123',
      'fulcrum_api_url' => 'https://api.marginarc.com/api/recommend',
      'phone_home_interval_days' => 7,
      'status' => 'active'
    };

    Map<String, Object> response = new Map<String, Object>{
      'success' => true,
      'config' => config
    };

    return new MarginArcLicenseMock(
      '/api/v1/license/activate',
      200,
      JSON.serialize(response)
    );
  }

  public static MarginArcLicenseMock successValidation() {
    Map<String, Object> config = new Map<String, Object>{
      'customer_id' => 'test-uuid-12345',
      'seats_licensed' => 50,
      'expiry_date' => '2027-02-11',
      'status' => 'active'
    };

    Map<String, Object> response = new Map<String, Object>{
      'valid' => true,
      'config' => config
    };

    return new MarginArcLicenseMock(
      '/api/v1/license/validate',
      200,
      JSON.serialize(response)
    );
  }

  public static MarginArcLicenseMock invalidLicense() {
    Map<String, Object> response = new Map<String, Object>{
      'valid' => false,
      'message' => 'Invalid license key'
    };

    return new MarginArcLicenseMock(
      '/api/v1/license/validate',
      200,
      JSON.serialize(response)
    );
  }

  public static MarginArcLicenseMock networkError() {
    return new MarginArcLicenseMock(
      '/api/v1/license/activate',
      500,
      '{"error": "Internal server error"}'
    );
  }

  public static MarginArcLicenseMock successTelemetry() {
    Map<String, Object> response = new Map<String, Object>{ 'success' => true };

    return new MarginArcLicenseMock(
      '/api/v1/telemetry',
      200,
      JSON.serialize(response)
    );
  }
}
