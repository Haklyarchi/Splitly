import os
from typing import List, Union, Optional
import google.generativeai as genai

# Configure Gemini API if an API key is available in environment variables
if os.environ.get("GEMINI_API_KEY"):
    genai.configure(api_key=os.environ["GEMINI_API_KEY"])

class UserMessage:
    def __init__(self, content: Union[str, List[Union[str, 'ImageContent']]]):
        self.content = content

class ImageContent:
    def __init__(self, image_bytes: bytes, mime_type: str = "image/jpeg"):
        self.image_bytes = image_bytes
        self.mime_type = mime_type

class LlmChat:
    def __init__(self, model_name: str = "gemini-2.5-flash", system_prompt: Optional[str] = None):
        self.model_name = model_name
        self.system_prompt = system_prompt
        
        generation_config = {}
        if system_prompt:
            generation_config["system_instruction"] = system_prompt
            
        self.model = genai.GenerativeModel(
            model_name=self.model_name,
            generation_config=generation_config
        )

    async def send_message_async(self, message: Union[str, UserMessage, List]) -> str:
        # Handle message content formatting for Gemini
        contents = []
        
        if isinstance(message, UserMessage):
            msg_content = message.content
        else:
            msg_content = message
            
        if isinstance(msg_content, list):
            for item in msg_content:
                if isinstance(item, ImageContent):
                    contents.append({
                        "mime_type": item.mime_type,
                        "data": item.image_bytes
                    })
                else:
                    contents.append(item)
        else:
            contents.append(msg_content)

        response = await self.model.generate_content_async(contents)
        return response.text