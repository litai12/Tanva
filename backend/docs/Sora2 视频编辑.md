> ## Documentation Index
> Fetch the complete documentation index at: https://docs.apimart.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Sora2 视频编辑

>  - 基于已生成的视频进行二次编辑
- 异步处理模式，返回任务ID用于后续查询
- 生成的视频链接有效期为24小时，请尽快保存 

<RequestExample>
  ```bash cURL theme={null}
  curl --request POST \
    --url https://api.apimart.ai/v1/videos/{video_id}/remix \
    --header 'Authorization: Bearer <token>' \
    --header 'Content-Type: application/json' \
    --data '{
      "model": "sora-2",
      "prompt": "再加一只小狗",
      "duration": 15,
      "aspect_ratio": "16:9"
    }'
  ```

  ```python Python theme={null}
  import requests

  url = "https://api.apimart.ai/v1/videos/{video_id}/remix"

  payload = {
      "model": "sora-2",
      "prompt": "再加一只小狗",
      "duration": 15,
      "aspect_ratio": "16:9"
  }

  headers = {
      "Authorization": "Bearer <token>",
      "Content-Type": "application/json"
  }

  response = requests.post(url, json=payload, headers=headers)

  print(response.json())
  ```

  ```javascript JavaScript theme={null}
  const url = "https://api.apimart.ai/v1/videos/{video_id}/remix";

  const payload = {
    model: "sora-2",
    prompt: "再加一只小狗",
    duration: 15,
    aspect_ratio: "16:9"
  };

  const headers = {
    "Authorization": "Bearer <token>",
    "Content-Type": "application/json"
  };

  fetch(url, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(payload)
  })
    .then(response => response.json())
    .then(data => console.log(data))
    .catch(error => console.error('Error:', error));
  ```

  ```go Go theme={null}
  package main

  import (
      "bytes"
      "encoding/json"
      "fmt"
      "io/ioutil"
      "net/http"
  )

  func main() {
      url := "https://api.apimart.ai/v1/videos/{video_id}/remix"

      payload := map[string]interface{}{
          "model":        "sora-2",
          "prompt":       "再加一只小狗",
          "duration":     15,
          "aspect_ratio": "16:9",
      }

      jsonData, _ := json.Marshal(payload)

      req, _ := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
      req.Header.Set("Authorization", "Bearer <token>")
      req.Header.Set("Content-Type", "application/json")

      client := &http.Client{}
      resp, err := client.Do(req)
      if err != nil {
          panic(err)
      }
      defer resp.Body.Close()

      body, _ := ioutil.ReadAll(resp.Body)
      fmt.Println(string(body))
  }
  ```

  ```java Java theme={null}
  import java.net.http.HttpClient;
  import java.net.http.HttpRequest;
  import java.net.http.HttpResponse;
  import java.net.URI;

  public class Main {
      public static void main(String[] args) throws Exception {
          String url = "https://api.apimart.ai/v1/videos/{video_id}/remix";

          String payload = """
          {
            "model": "sora-2",
            "prompt": "再加一只小狗",
            "duration": 15,
            "aspect_ratio": "16:9"
          }
          """;

          HttpClient client = HttpClient.newHttpClient();
          HttpRequest request = HttpRequest.newBuilder()
              .uri(URI.create(url))
              .header("Authorization", "Bearer <token>")
              .header("Content-Type", "application/json")
              .POST(HttpRequest.BodyPublishers.ofString(payload))
              .build();

          HttpResponse<String> response = client.send(request,
              HttpResponse.BodyHandlers.ofString());

          System.out.println(response.body());
      }
  }
  ```

  ```php PHP theme={null}
  <?php

  $url = "https://api.apimart.ai/v1/videos/{video_id}/remix";

  $payload = [
      "model" => "sora-2",
      "prompt" => "再加一只小狗",
      "duration" => 15,
      "aspect_ratio" => "16:9"
  ];

  $ch = curl_init($url);
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_POST, true);
  curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
  curl_setopt($ch, CURLOPT_HTTPHEADER, [
      "Authorization: Bearer <token>",
      "Content-Type: application/json"
  ]);

  $response = curl_exec($ch);
  curl_close($ch);

  echo $response;
  ?>
  ```

  ```ruby Ruby theme={null}
  require 'net/http'
  require 'json'
  require 'uri'

  url = URI("https://api.apimart.ai/v1/videos/{video_id}/remix")

  payload = {
    model: "sora-2",
    prompt: "再加一只小狗",
    duration: 15,
    aspect_ratio: "16:9"
  }

  http = Net::HTTP.new(url.host, url.port)
  http.use_ssl = true

  request = Net::HTTP::Post.new(url)
  request["Authorization"] = "Bearer <token>"
  request["Content-Type"] = "application/json"
  request.body = payload.to_json

  response = http.request(request)
  puts response.body
  ```

  ```swift Swift theme={null}
  import Foundation

  let url = URL(string: "https://api.apimart.ai/v1/videos/{video_id}/remix")!

  let payload: [String: Any] = [
      "model": "sora-2",
      "prompt": "再加一只小狗",
      "duration": 15,
      "aspect_ratio": "16:9"
  ]

  var request = URLRequest(url: url)
  request.httpMethod = "POST"
  request.setValue("Bearer <token>", forHTTPHeaderField: "Authorization")
  request.setValue("application/json", forHTTPHeaderField: "Content-Type")
  request.httpBody = try? JSONSerialization.data(withJSONObject: payload)

  let task = URLSession.shared.dataTask(with: request) { data, response, error in
      if let error = error {
          print("Error: \(error)")
          return
      }
      
      if let data = data, let responseString = String(data: data, encoding: .utf8) {
          print(responseString)
      }
  }

  task.resume()
  ```

  ```csharp C# theme={null}
  using System;
  using System.Net.Http;
  using System.Text;
  using System.Threading.Tasks;

  class Program
  {
      static async Task Main(string[] args)
      {
          var url = "https://api.apimart.ai/v1/videos/{video_id}/remix";

          var payload = @"{
              ""model"": ""sora-2"",
              ""prompt"": ""再加一只小狗"",
              ""duration"": 15,
              ""aspect_ratio"": ""16:9""
          }";

          using var client = new HttpClient();
          client.DefaultRequestHeaders.Add("Authorization", "Bearer <token>");

          var content = new StringContent(payload, Encoding.UTF8, "application/json");
          var response = await client.PostAsync(url, content);
          var result = await response.Content.ReadAsStringAsync();

          Console.WriteLine(result);
      }
  }
  ```

  ```c C theme={null}
  #include <stdio.h>
  #include <curl/curl.h>

  int main(void) {
      CURL *curl;
      CURLcode res;

      curl_global_init(CURL_GLOBAL_DEFAULT);
      curl = curl_easy_init();

      if(curl) {
          const char *url = "https://api.apimart.ai/v1/videos/{video_id}/remix";
          const char *payload = "{"
              "\"model\":\"sora-2\","
              "\"prompt\":\"再加一只小狗\","
              "\"duration\":15,"
              "\"aspect_ratio\":\"16:9\""
          "}";

          struct curl_slist *headers = NULL;
          headers = curl_slist_append(headers, "Authorization: Bearer <token>");
          headers = curl_slist_append(headers, "Content-Type: application/json");

          curl_easy_setopt(curl, CURLOPT_URL, url);
          curl_easy_setopt(curl, CURLOPT_POSTFIELDS, payload);
          curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);

          res = curl_easy_perform(curl);

          if(res != CURLE_OK) {
              fprintf(stderr, "curl_easy_perform() failed: %s\n",
                      curl_easy_strerror(res));
          }

          curl_slist_free_all(headers);
          curl_easy_cleanup(curl);
      }

      curl_global_cleanup();
      return 0;
  }
  ```

  ```objectivec Objective-C theme={null}
  #import <Foundation/Foundation.h>

  int main(int argc, const char * argv[]) {
      @autoreleasepool {
          NSURL *url = [NSURL URLWithString:@"https://api.apimart.ai/v1/videos/{video_id}/remix"];
          
          NSDictionary *payload = @{
              @"model": @"sora-2",
              @"prompt": @"再加一只小狗",
              @"duration": @15,
              @"aspect_ratio": @"16:9"
          };
          
          NSError *error;
          NSData *jsonData = [NSJSONSerialization dataWithJSONObject:payload
                                                            options:0
                                                              error:&error];
          
          NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
          [request setHTTPMethod:@"POST"];
          [request setValue:@"Bearer <token>" forHTTPHeaderField:@"Authorization"];
          [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
          [request setHTTPBody:jsonData];
          
          NSURLSessionDataTask *task = [[NSURLSession sharedSession] 
              dataTaskWithRequest:request
              completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
                  if (error) {
                      NSLog(@"Error: %@", error);
                      return;
                  }
                  NSString *result = [[NSString alloc] initWithData:data 
                                                          encoding:NSUTF8StringEncoding];
                  NSLog(@"%@", result);
              }];
          
          [task resume];
          [[NSRunLoop mainRunLoop] run];
      }
      return 0;
  }
  ```

  ```ocaml OCaml theme={null}
  (* Requires cohttp and yojson libraries *)
  open Lwt
  open Cohttp
  open Cohttp_lwt_unix

  let url = "https://api.apimart.ai/v1/videos/{video_id}/remix"

  let payload = {|{
    "model": "sora-2",
    "prompt": "再加一只小狗",
    "duration": 15,
    "aspect_ratio": "16:9"
  }|}

  let () =
    let headers = Header.init ()
      |> fun h -> Header.add h "Authorization" "Bearer <token>"
      |> fun h -> Header.add h "Content-Type" "application/json"
    in
    let body = Cohttp_lwt.Body.of_string payload in
    
    let response = Client.post ~headers ~body (Uri.of_string url) >>= fun (resp, body) ->
      body |> Cohttp_lwt.Body.to_string >|= fun body_str ->
      print_endline body_str
    in
    Lwt_main.run response
  ```

  ```dart Dart theme={null}
  import 'dart:convert';
  import 'package:http/http.dart' as http;

  void main() async {
    final url = Uri.parse('https://api.apimart.ai/v1/videos/{video_id}/remix');
    
    final payload = {
      'model': 'sora-2',
      'prompt': '再加一只小狗',
      'duration': 15,
      'aspect_ratio': '16:9'
    };
    
    final response = await http.post(
      url,
      headers: {
        'Authorization': 'Bearer <token>',
        'Content-Type': 'application/json',
      },
      body: jsonEncode(payload),
    );
    
    print(response.body);
  }
  ```

  ```r R theme={null}
  library(httr)
  library(jsonlite)

  url <- "https://api.apimart.ai/v1/videos/{video_id}/remix"

  payload <- list(
    model = "sora-2",
    prompt = "再加一只小狗",
    duration = 15,
    aspect_ratio = "16:9"
  )

  response <- POST(
    url,
    add_headers(
      Authorization = "Bearer <token>",
      `Content-Type` = "application/json"
    ),
    body = toJSON(payload, auto_unbox = TRUE),
    encode = "raw"
  )

  cat(content(response, "text"))
  ```
</RequestExample>

<ResponseExample>
  ```json 200 theme={null}
  {
    "code": 200,
    "data": [
      {
        "status": "submitted",
        "task_id": "task_01K8SGYNNNVBQTXNR4MM964S7K"
      }
    ]
  }
  ```

  ```json 400 theme={null}
  {
    "error": {
      "code": 400,
      "message": "Invalid request parameters",
      "type": "invalid_request_error"
    }
  }
  ```

  ```json 401 theme={null}
  {
    "error": {
      "code": 401,
      "message": "Invalid authentication credentials",
      "type": "authentication_error"
    }
  }
  ```

  ```json 402 theme={null}
  {
    "error": {
      "code": 402,
      "message": "Insufficient balance. Please top up your account",
      "type": "payment_required"
    }
  }
  ```

  ```json 403 theme={null}
  {
    "error": {
      "code": 403,
      "message": "Access forbidden. You don't have permission to access this resource",
      "type": "permission_error"
    }
  }
  ```

  ```json 404 theme={null}
  {
    "error": {
      "code": 404,
      "message": "Video not found",
      "type": "not_found_error"
    }
  }
  ```

  ```json 429 theme={null}
  {
    "error": {
      "code": 429,
      "message": "Rate limit exceeded. Please try again later",
      "type": "rate_limit_error"
    }
  }
  ```

  ```json 500 theme={null}
  {
    "error": {
      "code": 500,
      "message": "Internal server error. Please try again later",
      "type": "server_error"
    }
  }
  ```

  ```json 502 theme={null}
  {
    "error": {
      "code": 502,
      "message": "Bad gateway. The server is temporarily unavailable",
      "type": "bad_gateway"
    }
  }
  ```
</ResponseExample>

## 路径参数

<ParamField path="video_id" type="string" required>
  原视频任务 ID

  这是之前通过视频生成接口返回的任务ID
</ParamField>

## Authorizations

<ParamField header="Authorization" type="string" required>
  所有 API 端点都需要 Bearer Token 认证

  获取您的 API Key：

  访问 [API Key 管理页面](https://apimart.ai/console/token) 以获取您的 API Key

  将其添加到请求头中：

  ```
  Authorization: Bearer YOUR_API_KEY
  ```
</ParamField>

## Body

<ParamField body="model" type="string" default="sora-2" required>
  视频编辑模型名称

  支持的模型：

  * `sora-2` - 标准版本
  * `sora-2-pro` - 专业版本，支持更长时长

  示例：`"sora-2"` 或 `"sora-2-pro"`
</ParamField>

<ParamField body="prompt" type="string" required>
  编辑指令描述
</ParamField>

<ParamField body="duration" type="integer">
  视频时长（秒）

  * `sora-2`：支持 10 或 15 秒
  * `sora-2-pro`：支持 15 秒（高清）或 25 秒

  示例：`15`
</ParamField>

<ParamField body="aspect_ratio" type="string">
  视频宽高比

  支持的比例：

  * `16:9` - 标准宽屏（推荐）
  * `9:16` - 竖屏模式
  * `1:1` - 正方形

  示例：`"16:9"`
</ParamField>

## Response

<ResponseField name="created" type="integer">
  任务创建时间戳
</ResponseField>

<ResponseField name="id" type="string">
  唯一任务标识符
</ResponseField>

<ResponseField name="model" type="string">
  实际使用的模型名称
</ResponseField>

<ResponseField name="object" type="string">
  对象类型，固定为 `video.remix.task`
</ResponseField>

<ResponseField name="progress" type="integer">
  任务完成进度百分比 (0-100)
</ResponseField>

<ResponseField name="status" type="string">
  任务状态

  可能的值：

  * `pending` - 等待处理
  * `processing` - 处理中
  * `completed` - 已完成
  * `failed` - 失败
</ResponseField>

<ResponseField name="task_info" type="object">
  任务详细信息

  <Expandable title="属性">
    <ResponseField name="can_cancel" type="boolean">
      任务是否可以取消
    </ResponseField>

    <ResponseField name="estimated_time" type="integer">
      预计完成时间（秒）
    </ResponseField>
  </Expandable>
</ResponseField>

<ResponseField name="type" type="string">
  输出类型，固定为 `video`
</ResponseField>

<ResponseField name="usage" type="object">
  计费信息

  <Expandable title="属性">
    <ResponseField name="total_tokens" type="integer">
      消耗的总 token 数
    </ResponseField>
  </Expandable>
</ResponseField>
