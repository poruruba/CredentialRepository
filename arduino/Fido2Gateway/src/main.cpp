#include <Arduino.h>
#include <SPI.h>
#include <Wire.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include "BLE2902.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Adafruit_NeoPixel.h>

#define FIDO_EMULATOR_API_KEY "【Node.jsサーバ通信時のAPIキー】"
const char *endpoint_u2f_register = "http://【Node.jsサーバのホスト名】:20080/device/u2f_register";
const char *endpoint_u2f_authenticate = "http://【Node.jsサーバのホスト名】:20080/device/u2f_authenticate";
const char *endpoint_u2f_version = "http://【Node.jsサーバのホスト名】:20080/device/u2f_version";

#define BUTTON_PORT 3
#define PIXELS_PORT  2
#define NUM_OF_PIXELS 1
static Adafruit_NeoPixel pixels(NUM_OF_PIXELS, PIXELS_PORT, NEO_GRB + NEO_KHZ800);

//#define WIFI_SSID "【固定のWiFiアクセスポイントのSSID】" // WiFiアクセスポイントのSSID
//#define WIFI_PASSWORD "【固定のWiFIアクセスポイントのパスワード】" // WiFIアクセスポイントのパスワード
#define WIFI_SSID NULL // WiFiアクセスポイントのSSID
#define WIFI_PASSWORD NULL // WiFIアクセスポイントのパスワード
#define WIFI_TIMEOUT  10000
#define SERIAL_TIMEOUT1  10000
#define SERIAL_TIMEOUT2  20000
static long wifi_try_connect(bool infinit_loop);

#define SERVICE_UUID_fido BLEUUID((uint16_t)0xfffd)
#define CHARACTERISTIC_UUID_fidoControlPoint "F1D0FFF1-DEAA-ECEE-B42F-C9BA7ED623BB"
#define CHARACTERISTIC_UUID_fidoStatus "F1D0FFF2-DEAA-ECEE-B42F-C9BA7ED623BB"
#define CHARACTERISTIC_UUID_fidoControlPointLength "F1D0FFF3-DEAA-ECEE-B42F-C9BA7ED623BB"
#define CHARACTERISTIC_UUID_fidoServiceRevisionBitfield "F1D0FFF4-DEAA-ECEE-B42F-C9BA7ED623BB"
#define CHARACTERISTIC_UUID_fidoServiceRevision BLEUUID((uint16_t)0x2A28)

#define SERVICE_UUID_DeviceInfo BLEUUID((uint16_t)0x180a)
#define CHARACTERISTIC_UUID_ManufacturerName BLEUUID((uint16_t)0x2A29)
#define CHARACTERISTIC_UUID_ModelNumber BLEUUID((uint16_t)0x2A24)
#define CHARACTERISTIC_UUID_FirmwareRevision BLEUUID((uint16_t)0x2A26)

#define DEVICE_NAME "Fido2Gateway"
#define BLE_PASSKEY 123456
#define DISCONNECT_WAIT 3000
#define BLE_ADVERTISE_INTERVAL  30000

bool connected = false;
bool button_pushed = false;
bool is_advertising = false;
uint32_t start_advertising = 0;

const int capacity = 2048;
StaticJsonDocument<capacity> json_document;
char json_buffer[2048];
unsigned short recv_len = 0;
unsigned short expected_len = 0;
unsigned char expected_slot = 0;
unsigned char recv_buffer[2048];

#define PACKET_BUFFER_SIZE 20

HTTPClient http;

BLECharacteristic *pCharacteristic_fidoControlPoint;
BLECharacteristic *pCharacteristic_fidoStatus;
BLECharacteristic *pCharacteristic_fidoControlPointLength;
BLECharacteristic *pCharacteristic_fidoServiceRevisionBitfield;
BLECharacteristic *pCharacteristic_fidoServiceRevision;

uint8_t value_fidoControlPoint[PACKET_BUFFER_SIZE] = {0x00};
uint8_t value_fidoStatus[PACKET_BUFFER_SIZE] = {0x00};
uint8_t value_fidoControlPointLength[2] = {(PACKET_BUFFER_SIZE >> 8) & 0xff, PACKET_BUFFER_SIZE}; /* Length PACKET_BUFFER_SIZE */
uint8_t value_fidoServiceRevisionBitfield[1] = {0x80};                                            /* Version 1.1 */
uint8_t value_fidoServiceRevision[3] = {0x31, 0x2e, 0x30};                                        /* "1.0" */
uint8_t value_appearance[2] = {0x40, 0x03};

BLEAdvertising *g_pAdvertising = NULL;

void dump_bin(const char *p_message, const uint8_t *p_bin, unsigned short len)
{
  Serial.printf("%s", p_message);
  for (unsigned short i = 0; i < len; i++){
    Serial.printf("%02x ", p_bin[i]);
  }
  Serial.println("");
}

char toC(unsigned char bin)
{
  if (bin >= 0 && bin <= 9)
    return '0' + bin;
  if (bin >= 0x0a && bin <= 0x0f)
    return 'a' + bin - 10;
  return '0';
}

unsigned char tohex(char c)
{
  if (c >= '0' && c <= '9')
    return c - '0';
  if (c >= 'a' && c <= 'f')
    return c - 'a' + 10;
  if (c >= 'F' && c <= 'F')
    return c - 'A' + 10;

  return 0;
}

long parse_hex(const char *p_hex, unsigned char *p_bin)
{
  int index = 0;
  while (p_hex[index * 2] != '\0')
  {
    p_bin[index] = tohex(p_hex[index * 2]) << 4;
    p_bin[index] |= tohex(p_hex[index * 2 + 1]);
    index++;
  }

  return index;
}

std::string create_string(const unsigned char *p_bin, unsigned short len)
{
  std::string str = "";
  for (int i = 0; i < len; i++)
  {
    str += toC((p_bin[i] >> 4) & 0x0f);
    str += toC(p_bin[i] & 0x0f);
  }

  return str;
}

class MyCallbacks : public BLEServerCallbacks
{
  void onConnect(BLEServer *pServer)
  {
    connected = true;
    Serial.println("Connected\n");
    pixels.setPixelColor(0, 0x0000ff);
    pixels.show();
  }

  void onDisconnect(BLEServer *pServer)
  {
    connected = false;
    BLE2902 *desc = (BLE2902 *)pCharacteristic_fidoStatus->getDescriptorByUUID(BLEUUID((uint16_t)0x2902));
    desc->setNotifications(false);
    Serial.println("Disconnected\n");

    pixels.setPixelColor(0, 0x00ff00);
    pixels.show();

    is_advertising = false;
    g_pAdvertising->stop();
//    delay(DISCONNECT_WAIT);
//    g_pAdvertising->start();
  }
};

class MySecurity : public BLESecurityCallbacks
{
  bool onConfirmPIN(uint32_t pin)
  {
    Serial.println("onConfirmPIN number:");
    Serial.println(pin);
    return false;
  }

  uint32_t onPassKeyRequest()
  {
    Serial.println("onPassKeyRequest");
    return BLE_PASSKEY;
  }

  void onPassKeyNotify(uint32_t pass_key)
  {
    // ペアリング時のPINの表示
    Serial.println("onPassKeyNotify number");
//    Serial.println(pass_key);
  }

  bool onSecurityRequest()
  {
    /* ペアリング要否 */
    Serial.println("onSecurityRequest");
    return true;
  }

  void onAuthenticationComplete(esp_ble_auth_cmpl_t cmpl)
  {
    Serial.println("onAuthenticationComplete");
    if (cmpl.success)
    {
      // ペアリング完了
      Serial.println("auth success");
    }
    else
    {
      // ペアリング失敗
      Serial.println("auth failed");
    }
  }
};

class MyCharacteristicCallbacks : public BLECharacteristicCallbacks
{
  void onWrite(BLECharacteristic *pCharacteristic)
  {
    Serial.print("onWrite : ");

    uint8_t *value = pCharacteristic->getData();
    std::string str = pCharacteristic->getValue();

    dump_bin("onWrite : ", value, str.length());

    if (expected_len > 0 && value[0] != expected_slot)
      expected_len = 0;

    if (expected_len == 0){
      if (value[0] != 0x83)
        return;
      recv_len = 0;
      expected_len = (value[1] << 8) | value[2];
      memmove(&recv_buffer[recv_len], &value[3], str.length() - 3);
      recv_len += str.length() - 3;
      expected_slot = 0;
      if (recv_len < expected_len)
        return;
    }
    else
    {
      memmove(&recv_buffer[recv_len], &value[1], str.length() - 1);
      recv_len += str.length() - 1;
      expected_slot++;
      if (recv_len < expected_len)
        return;
    }
    expected_len = 0;

    switch (recv_buffer[1])
    {
    case 0x01:
      Serial.println("u2f_register called");
      http.begin(endpoint_u2f_register);
      break;
    case 0x02:
      Serial.println("u2f_authenticate called");
      http.begin(endpoint_u2f_authenticate);
      break;
    case 0x03:
      Serial.println("u2f_version called");
      http.begin(endpoint_u2f_version);
      break;
    default:
      Serial.println("Unknown INS");
      return;
    }

    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-API-KEY", FIDO_EMULATOR_API_KEY);

    json_document.clear();
    json_document["input"] = (char*)create_string(&recv_buffer[0], recv_len).c_str();
    serializeJson(json_document, json_buffer, sizeof(json_buffer));
    Serial.println(json_buffer);

    Serial.println("http.POST");
    int status_code = http.POST((uint8_t *)json_buffer, strlen(json_buffer));
    Serial.printf("status_code=%d\r\n", status_code);
    if (status_code == 200)
    {
      Stream *resp = http.getStreamPtr();

//      DynamicJsonDocument json_response(2048);
      json_document.clear();
      deserializeJson(json_document, *resp);

      serializeJson(json_document, Serial);
      Serial.println("");

      const char *result = json_document["result"];
      //      Serial.println(result);
      unsigned short resp_len = parse_hex(result, recv_buffer);

      int offset = 0;
      int slot = 0;
      int packet_size = 0;
      do{
        if (offset == 0){
          value_fidoStatus[0] = 0x83;
          value_fidoStatus[1] = (resp_len >> 8) & 0xff;
          value_fidoStatus[2] = resp_len & 0xff;
          packet_size = resp_len - offset;
          if (packet_size > (PACKET_BUFFER_SIZE - 3))
            packet_size = PACKET_BUFFER_SIZE - 3;
          memmove(&value_fidoStatus[3], &recv_buffer[offset], packet_size);

          dump_bin("Notify : ", value_fidoStatus, packet_size + 3);

          pCharacteristic_fidoStatus->setValue(value_fidoStatus, packet_size + 3);
          pCharacteristic_fidoStatus->notify(true);
          delay(10);

          offset += packet_size;
          packet_size += 3;
        }else{
          value_fidoStatus[0] = slot++;
          packet_size = resp_len - offset;
          if (packet_size > (PACKET_BUFFER_SIZE - 1))
            packet_size = PACKET_BUFFER_SIZE - 1;
          memmove(&value_fidoStatus[1], &recv_buffer[offset], packet_size);

          dump_bin("Notify : ", value_fidoStatus, packet_size + 1);

          pCharacteristic_fidoStatus->setValue(value_fidoStatus, packet_size + 1);
          pCharacteristic_fidoStatus->notify(true);
          delay(10);

          offset += packet_size;
          packet_size += 1;
        }
      } while (packet_size >= PACKET_BUFFER_SIZE);
    }

    http.end();
  }
};

void taskServer(void *)
{
  BLEDevice::init(DEVICE_NAME);
  /* ESP_BLE_SEC_ENCRYPT_MITM, ESP_BLE_SEC_ENCRYPT */
  BLEDevice::setEncryptionLevel(ESP_BLE_SEC_ENCRYPT_MITM);
  BLEDevice::setSecurityCallbacks(new MySecurity());

  BLEServer *pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyCallbacks());

  BLESecurity *pSecurity = new BLESecurity();
  pSecurity->setKeySize(16);
  //  pSecurity->setStaticPIN(BLE_PASSKEY);

  /* ESP_LE_AUTH_NO_BOND, ESP_LE_AUTH_BOND, ESP_LE_AUTH_REQ_MITM */
  //  pSecurity->setAuthenticationMode(ESP_LE_AUTH_REQ_MITM);
  pSecurity->setAuthenticationMode(ESP_LE_AUTH_BOND);

  /* for fixed passkey */
  uint32_t passkey = BLE_PASSKEY;
  esp_ble_gap_set_security_param(ESP_BLE_SM_SET_STATIC_PASSKEY, &passkey, sizeof(uint32_t));

  /* ESP_IO_CAP_IN, ESP_IO_CAP_OUT, ESP_IO_CAP_KBDISP */
  pSecurity->setCapability(ESP_IO_CAP_OUT);
  //  pSecurity->setCapability(ESP_IO_CAP_IN);
  pSecurity->setInitEncryptionKey(ESP_BLE_ENC_KEY_MASK | ESP_BLE_ID_KEY_MASK);

  BLEService *pService = pServer->createService(SERVICE_UUID_fido);

  pCharacteristic_fidoControlPoint = pService->createCharacteristic(CHARACTERISTIC_UUID_fidoControlPoint, BLECharacteristic::PROPERTY_WRITE);
  pCharacteristic_fidoControlPoint->setAccessPermissions(ESP_GATT_PERM_WRITE /* ESP_GATT_PERM_WRITE_ENCRYPTED */);
  pCharacteristic_fidoControlPoint->setValue(value_fidoControlPoint, sizeof(value_fidoControlPoint));
  pCharacteristic_fidoControlPoint->setCallbacks(new MyCharacteristicCallbacks());

  pCharacteristic_fidoStatus = pService->createCharacteristic(CHARACTERISTIC_UUID_fidoStatus, BLECharacteristic::PROPERTY_NOTIFY);
  pCharacteristic_fidoStatus->addDescriptor(new BLE2902());

  pCharacteristic_fidoControlPointLength = pService->createCharacteristic(CHARACTERISTIC_UUID_fidoControlPointLength, BLECharacteristic::PROPERTY_READ);
  pCharacteristic_fidoControlPointLength->setAccessPermissions(ESP_GATT_PERM_READ);
  pCharacteristic_fidoControlPointLength->setValue(value_fidoControlPointLength, sizeof(value_fidoControlPointLength));

  pCharacteristic_fidoServiceRevisionBitfield = pService->createCharacteristic(CHARACTERISTIC_UUID_fidoServiceRevisionBitfield, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE);
  pCharacteristic_fidoServiceRevisionBitfield->setAccessPermissions(ESP_GATT_PERM_READ | ESP_GATT_PERM_WRITE);
  pCharacteristic_fidoServiceRevisionBitfield->setValue(value_fidoServiceRevisionBitfield, sizeof(value_fidoServiceRevisionBitfield));

  pCharacteristic_fidoServiceRevision = pService->createCharacteristic(CHARACTERISTIC_UUID_fidoServiceRevision, BLECharacteristic::PROPERTY_READ);
  pCharacteristic_fidoServiceRevision->setAccessPermissions(ESP_GATT_PERM_READ);
  pCharacteristic_fidoServiceRevision->setValue(value_fidoServiceRevision, sizeof(value_fidoServiceRevision));

  pService->start();

  BLECharacteristic *pCharacteristic;

  BLEService *pService_DeviceInfo = pServer->createService(SERVICE_UUID_DeviceInfo);

  pCharacteristic = pService_DeviceInfo->createCharacteristic(CHARACTERISTIC_UUID_ManufacturerName, BLECharacteristic::PROPERTY_READ);
  pCharacteristic->setAccessPermissions(ESP_GATT_PERM_READ);
  pCharacteristic->setValue("SampleModel");

  pCharacteristic = pService_DeviceInfo->createCharacteristic(CHARACTERISTIC_UUID_ModelNumber, BLECharacteristic::PROPERTY_READ);
  pCharacteristic->setAccessPermissions(ESP_GATT_PERM_READ);
  pCharacteristic->setValue("M1.0");

  pCharacteristic = pService_DeviceInfo->createCharacteristic(CHARACTERISTIC_UUID_FirmwareRevision, BLECharacteristic::PROPERTY_READ);
  pCharacteristic->setAccessPermissions(ESP_GATT_PERM_READ);
  pCharacteristic->setValue("F1.0");

  pService_DeviceInfo->start();

  g_pAdvertising = pServer->getAdvertising();
  g_pAdvertising->addServiceUUID(SERVICE_UUID_fido);
//  g_pAdvertising->start();

  vTaskDelay(portMAX_DELAY); //delay(portMAX_DELAY);
}

void setup()
{
  Serial.begin(115200);
  Serial.println("Starting setup");

  long ret;
  
  pixels.begin();
  pinMode(BUTTON_PORT, INPUT_PULLUP);

  pixels.setPixelColor(0, 0xff0000);
  pixels.show();

  ret = wifi_try_connect(true);
  if( ret != 0 ){
    Serial.println("Wifi can't connect");
    while(1);
  }
  pixels.setPixelColor(0, 0x00ff00);
  pixels.show();

  Serial.println("Starting BLE work!");
  xTaskCreate(taskServer, "server", 10000, NULL, 5, NULL);
}

void loop()
{
  if (connected){
    // do something
  }else{
    if( is_advertising && (start_advertising + BLE_ADVERTISE_INTERVAL) < millis() ){
        is_advertising = false;
        g_pAdvertising->stop();
        Serial.println("ble advertising stop");
        delay(DISCONNECT_WAIT);
    }

    if( !digitalRead(BUTTON_PORT) ){
      if( !button_pushed ){
        button_pushed = true;
        Serial.println("button pressed");
        if( !is_advertising ){
          is_advertising = true;
          start_advertising = millis();
          Serial.println("ble advertising start");
          g_pAdvertising->start();
        }else{
          start_advertising = millis();
        }
        delay(100);
      }
    }else{
      button_pushed = false;
    }
  }

  delay(1);
}

static long wifi_connect(const char *ssid, const char *password, unsigned long timeout)
{
  Serial.println("");
  Serial.print("WiFi Connenting");

  if( ssid == NULL && password == NULL )
    WiFi.begin();
  else
    WiFi.begin(ssid, password);
  unsigned long past = 0;
  while (WiFi.status() != WL_CONNECTED){
    Serial.print(".");
    delay(500);
    past += 500;
    if( past > timeout ){
      Serial.println("\nCan't Connect");
      return -1;
    }
  }
  Serial.print("\nConnected : IP=");
  Serial.print(WiFi.localIP());
  Serial.print(" Mac=");
  Serial.println(WiFi.macAddress());

  return 0;
}

static long wifi_try_connect(bool infinit_loop)
{
  long ret = -1;
  do{
    ret = wifi_connect(WIFI_PASSWORD, WIFI_PASSWORD, WIFI_TIMEOUT);
    if( ret == 0 )
      return ret;

    Serial.print("\ninput SSID:");
    Serial.setTimeout(SERIAL_TIMEOUT1);
    char ssid[32 + 1] = {'\0'};
    ret = Serial.readBytesUntil('\r', ssid, sizeof(ssid) - 1);
    if( ret <= 0 )
      continue;

    delay(10);
    Serial.read();
    Serial.print("\ninput PASSWORD:");
    Serial.setTimeout(SERIAL_TIMEOUT2);
    char password[32 + 1] = {'\0'};
    ret = Serial.readBytesUntil('\r', password, sizeof(password) - 1);
    if( ret <= 0 )
      continue;

    delay(10);
    Serial.read();
    Serial.printf("\nSSID=%s PASSWORD=", ssid);
    for( int i = 0 ; i < strlen(password); i++ )
      Serial.print("*");
    Serial.println("");

    ret = wifi_connect(ssid, password, WIFI_TIMEOUT);
    if( ret == 0 )
      return ret;
  }while(infinit_loop);

  return ret;
}