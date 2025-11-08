import { GoogleGenAI, Modality } from "@google/genai";
import * as fs from "node:fs";

async function main() {
  // 使用你的API密钥
  const ai = new GoogleGenAI({ 
    apiKey: "AIzaSyDUKP60M4YLpyyStCOvntwDtPX0zvl5F64" 
  });

  const prompt = "Create a picture of a nano banana dish in a fancy restaurant with a Gemini theme";

  console.log("🎨 开始生成图像...");
  console.log("📝 提示词:", prompt);

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: prompt,
      config: {
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" }
        ],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: {
            aspectRatio: "1:1"
          }
        }
      }
    });

    console.log("✅ 生成完成!");
    
    for (const part of response.candidates[0].content.parts) {
      if (part.text) {
        console.log("📄 文本回复:", part.text);
      } else if (part.inlineData) {
        const imageData = part.inlineData.data;
        const buffer = Buffer.from(imageData, "base64");
        fs.writeFileSync("gemini-nano-banana-image.png", buffer);
        console.log("🖼️  图像已保存为: gemini-nano-banana-image.png");
        console.log("📊 图像大小:", buffer.length, "bytes");
      }
    }
  } catch (error) {
    console.error("❌ 生成失败:", error.message);
    if (error.details) {
      console.error("🔍 错误详情:", error.details);
    }
  }
}

main().catch(console.error);

