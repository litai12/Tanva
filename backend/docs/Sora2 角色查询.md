> ## Documentation Index
> Fetch the complete documentation index at: https://docs.apimart.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Sora2 查询角色（角色管理）

>  - 查询角色创建任务的状态和结果
- 获取已创建角色的详细信息
- 返回角色ID可用于后续视频生成 

<RequestExample>
  ```bash cURL theme={null}
  curl --request GET \
    --url https://api.apimart.ai/v1/characters_tasks/task_01KBZ0TZZ7C7M3WS1TJM0PH8J4 \
    --header 'Authorization: Bearer <token>'
  ```

  ```python Python theme={null}
  import requests

  task_id = "task_01KBZ0TZZ7C7M3WS1TJM0PH8J4"
  url = f"https://api.apimart.ai/v1/characters_tasks/{task_id}"

  headers = {
      "Authorization": "Bearer <token>"
  }

  response = requests.get(url, headers=headers)

  print(response.json())
  ```

  ```javascript JavaScript theme={null}
  const taskId = "task_01KBZ0TZZ7C7M3WS1TJM0PH8J4";
  const url = `https://api.apimart.ai/v1/characters_tasks/${taskId}`;

  const headers = {
    "Authorization": "Bearer <token>"
  };

  fetch(url, {
    method: "GET",
    headers: headers
  })
    .then(response => response.json())
    .then(data => console.log(data))
    .catch(error => console.error('Error:', error));
  ```

  ```go Go theme={null}
  package main

  import (
      "fmt"
      "io/ioutil"
      "net/http"
  )

  func main() {
      taskId := "task_01KBZ0TZZ7C7M3WS1TJM0PH8J4"
      url := "https://api.apimart.ai/v1/characters_tasks/" + taskId

      req, _ := http.NewRequest("GET", url, nil)
      req.Header.Set("Authorization", "Bearer <token>")

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
          String taskId = "task_01KBZ0TZZ7C7M3WS1TJM0PH8J4";
          String url = "https://api.apimart.ai/v1/characters_tasks/" + taskId;

          HttpClient client = HttpClient.newHttpClient();
          HttpRequest request = HttpRequest.newBuilder()
              .uri(URI.create(url))
              .header("Authorization", "Bearer <token>")
              .GET()
              .build();

          HttpResponse<String> response = client.send(request,
              HttpResponse.BodyHandlers.ofString());

          System.out.println(response.body());
      }
  }
  ```

  ```php PHP theme={null}
  <?php

  $taskId = "task_01KBZ0TZZ7C7M3WS1TJM0PH8J4";
  $url = "https://api.apimart.ai/v1/characters_tasks/" . $taskId;

  $ch = curl_init($url);
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_HTTPHEADER, [
      "Authorization: Bearer <token>"
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

  task_id = "task_01KBZ0TZZ7C7M3WS1TJM0PH8J4"
  url = URI("https://api.apimart.ai/v1/characters_tasks/#{task_id}")

  http = Net::HTTP.new(url.host, url.port)
  http.use_ssl = true

  request = Net::HTTP::Get.new(url)
  request["Authorization"] = "Bearer <token>"

  response = http.request(request)
  puts response.body
  ```

  ```swift Swift theme={null}
  import Foundation

  let taskId = "task_01KBZ0TZZ7C7M3WS1TJM0PH8J4"
  let url = URL(string: "https://api.apimart.ai/v1/characters_tasks/\(taskId)")!

  var request = URLRequest(url: url)
  request.httpMethod = "GET"
  request.setValue("Bearer <token>", forHTTPHeaderField: "Authorization")

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
  using System.Threading.Tasks;

  class Program
  {
      static async Task Main(string[] args)
      {
          var taskId = "task_01KBZ0TZZ7C7M3WS1TJM0PH8J4";
          var url = $"https://api.apimart.ai/v1/characters_tasks/{taskId}";

          using var client = new HttpClient();
          client.DefaultRequestHeaders.Add("Authorization", "Bearer <token>");

          var response = await client.GetAsync(url);
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
          const char *url = "https://api.apimart.ai/v1/characters_tasks/task_01KBZ0TZZ7C7M3WS1TJM0PH8J4";

          struct curl_slist *headers = NULL;
          headers = curl_slist_append(headers, "Authorization: Bearer <token>");

          curl_easy_setopt(curl, CURLOPT_URL, url);
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
          NSString *taskId = @"task_01KBZ0TZZ7C7M3WS1TJM0PH8J4";
          NSString *urlString = [NSString stringWithFormat:@"https://api.apimart.ai/v1/characters_tasks/%@", taskId];
          NSURL *url = [NSURL URLWithString:urlString];
          
          NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
          [request setHTTPMethod:@"GET"];
          [request setValue:@"Bearer <token>" forHTTPHeaderField:@"Authorization"];
          
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

  let task_id = "task_01KBZ0TZZ7C7M3WS1TJM0PH8J4"
  let url = "https://api.apimart.ai/v1/characters_tasks/" ^ task_id

  let () =
    let headers = Header.init ()
      |> fun h -> Header.add h "Authorization" "Bearer <token>"
    in
    
    let response = Client.get ~headers (Uri.of_string url) >>= fun (resp, body) ->
      body |> Cohttp_lwt.Body.to_string >|= fun body_str ->
      print_endline body_str
    in
    Lwt_main.run response
  ```

  ```dart Dart theme={null}
  import 'dart:convert';
  import 'package:http/http.dart' as http;

  void main() async {
    final taskId = 'task_01KBZ0TZZ7C7M3WS1TJM0PH8J4';
    final url = Uri.parse('https://api.apimart.ai/v1/characters_tasks/$taskId');
    
    final response = await http.get(
      url,
      headers: {
        'Authorization': 'Bearer <token>',
      },
    );
    
    print(response.body);
  }
  ```

  ```r R theme={null}
  library(httr)
  library(jsonlite)

  task_id <- "task_01KBZ0TZZ7C7M3WS1TJM0PH8J4"
  url <- paste0("https://api.apimart.ai/v1/characters_tasks/", task_id)

  response <- GET(
    url,
    add_headers(
      Authorization = "Bearer <token>"
    )
  )

  cat(content(response, "text"))
  ```
</RequestExample>

<ResponseExample>
  ```json 200 theme={null}
  {
    "code": 200,
    "data": {
      "actual_time": 46,
      "completed": 1765251507,
      "created": 1765251461,
      "estimated_time": 30,
      "id": "task_01KC0JZCMTMQ70D68XTM56Q5D0",
      "progress": 100,
      "result": {
        "characters": [
          {
            "display_name": "Turbo Whiskers",
            "id": "ch_6937998961208191a45ef08447a554df",
            "profile_picture_url": "https://upload.apimart.ai/f/image/9998234748474202-d5305f13-3dec-4420-9cae-2f5a6a809719-character_task_01KC0JZCMTMQ70D68XTM56Q5D0.jpg",
            "username": "duksvfkf.turbo_whis"
          }
        ]
      },
      "status": "completed"
    }
  }
  ```

  ```json 400 theme={null}
  {
    "error": {
      "code": 400,
      "message": "请求参数无效",
      "type": "invalid_request_error"
    }
  }
  ```

  ```json 401 theme={null}
  {
    "error": {
      "code": 401,
      "message": "身份验证失败，请检查您的API密钥",
      "type": "authentication_error"
    }
  }
  ```

  ```json 404 theme={null}
  {
    "error": {
      "code": 404,
      "message": "任务不存在",
      "type": "not_found_error"
    }
  }
  ```

  ```json 429 theme={null}
  {
    "error": {
      "code": 429,
      "message": "请求过于频繁，请稍后再试",
      "type": "rate_limit_error"
    }
  }
  ```

  ```json 500 theme={null}
  {
    "error": {
      "code": 500,
      "message": "服务器内部错误，请稍后重试",
      "type": "server_error"
    }
  }
  ```
</ResponseExample>

## 路径参数

<ParamField path="task_id" type="string" required>
  角色创建任务 ID

  这是通过创建角色接口返回的任务 ID

  示例：`"task_01KBZ0TZZ7C7M3WS1TJM0PH8J4"`
</ParamField>

## Authorizations

<ParamField header="Authorization" type="string" required>
  所有接口均需要使用Bearer Token进行认证

  获取 API Key：

  访问 [API Key 管理页面](https://apimart.ai/console/token) 获取您的 API Key

  使用时在请求头中添加：

  ```
  Authorization: Bearer YOUR_API_KEY
  ```
</ParamField>

## Response

<ResponseField name="code" type="integer">
  响应状态码，成功时为 200
</ResponseField>

<ResponseField name="data" type="object">
  返回数据对象

  <Expandable title="字段说明">
    <ResponseField name="id" type="string">
      任务唯一标识符

      示例：`"task_01KC0JZCMTMQ70D68XTM56Q5D0"`
    </ResponseField>

    <ResponseField name="status" type="string">
      任务状态

      可能的值：

      * `pending` - 等待处理
      * `processing` - 处理中
      * `completed` - 已完成
      * `failed` - 失败

      示例：`"completed"`
    </ResponseField>

    <ResponseField name="progress" type="integer">
      任务完成进度百分比 (0-100)

      示例：`100`
    </ResponseField>

    <ResponseField name="created" type="integer">
      任务创建时间戳（Unix 时间戳）

      示例：`1765251461`
    </ResponseField>

    <ResponseField name="completed" type="integer">
      任务完成时间戳（Unix 时间戳）

      示例：`1765251507`
    </ResponseField>

    <ResponseField name="estimated_time" type="integer">
      预计处理时间（秒）

      示例：`30`
    </ResponseField>

    <ResponseField name="actual_time" type="integer">
      实际处理时间（秒）

      示例：`46`
    </ResponseField>

    <ResponseField name="result" type="object">
      任务结果

      <Expandable title="result 字段">
        <ResponseField name="characters" type="array">
          角色数组

          <Expandable title="角色对象">
            <ResponseField name="id" type="string">
              角色唯一标识符

              此 ID 可在视频生成时通过 `character_url` 参数引用该角色

              示例：`"ch_6937998961208191a45ef08447a554df"`
            </ResponseField>

            <ResponseField name="display_name" type="string">
              角色显示名称

              示例：`"Turbo Whiskers"`
            </ResponseField>

            <ResponseField name="profile_picture_url" type="string">
              角色头像图片 URL

              示例：`"https://upload.apimart.ai/f/image/...character_task_xxx.jpg"`
            </ResponseField>

            <ResponseField name="username" type="string">
              角色用户名，可在 prompt 中使用 `@username` 引用该角色

              示例：`"duksvfkf.turbo_whis"`
            </ResponseField>
          </Expandable>
        </ResponseField>
      </Expandable>
    </ResponseField>
  </Expandable>
</ResponseField>
