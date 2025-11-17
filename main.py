from flask import Flask, request, jsonify, render_template, send_from_directory
from flask_cors import CORS
from diffusers import DiffusionPipeline
from peft import PeftModel
import torch
import uuid
import os
import json
from typing import Dict, List, Optional
from dataclasses import dataclass, asdict

# ============================================
# Configuration
# ============================================
class Config:
    FINAL = "/root/Project/static/sources/Model" # not done yet
    BASE_MODEL_ID = "stabilityai/stable-diffusion-xl-base-1.0"      
    REFINER_MODEL_ID = "stabilityai/stable-diffusion-xl-refiner-1.0"
    IMAGE_SIZE = 880       
    SESSIONS_FILE = "/root/Project/sessions.json"
    STATIC_DIR = "/root/Project/static"
    GENERATED_DIR = os.path.join(STATIC_DIR, "generated")
    SOURCES_DIR = os.path.join(STATIC_DIR, "sources")
    PORT = 5000
    DEBUG = False

# ============================================
# Data Models
# ============================================
@dataclass
class Message:
    id: str
    sender: str
    text: Optional[str] = None
    image_url: Optional[str] = None
    status: Optional[str] = None

@dataclass
class Session:
    title: str
    messages: List[Dict]

# ============================================
# Application Setup
# ============================================
app = Flask(__name__)
CORS(app)

# Device configuration
device = "cuda" if torch.cuda.is_available() else "cpu"
dtype = torch.float16 if device == "cuda" else torch.float32

# Load Base SDXL model
pipe_base = DiffusionPipeline.from_pretrained(
    Config.BASE_MODEL_ID,
    use_safetensors = True,
    torch_dtype=dtype
).to(device)

pipe_base.enable_attention_slicing()
pipe_base.enable_vae_slicing()

pipe_base.unet = PeftModel.from_pretrained(
    pipe_base.unet,
    Config.FINAL
)
pipe_base.unet = pipe_base.unet.merge_and_unload()

pipe_refiner = DiffusionPipeline.from_pretrained(
    Config.REFINER_MODEL_ID,
    torch_dtype = dtype,
    use_safetensors = True
).to(device)
pipe_refiner.enable_attention_slicing()
pipe_refiner.enable_vae_slicing()

# ============================================
# Session Management
# ============================================
class SessionManager:
    def __init__(self, filepath: str):
        self.filepath = filepath
        self.sessions = self._load_sessions()
    
    def _load_sessions(self) -> Dict:
        """Load sessions from JSON file"""
        if os.path.exists(self.filepath):
            try:
                with open(self.filepath, "r", encoding="utf-8") as f:
                    return json.load(f)
            except json.JSONDecodeError:
                print(f"Warning: Could not decode {self.filepath}, starting fresh")
                return {}
        return {}
    
    def save(self):
        """Save sessions to JSON file"""
        try:
            with open(self.filepath, "w", encoding="utf-8") as f:
                json.dump(self.sessions, f, ensure_ascii=False, indent=2)
        except IOError as e:
            print(f"Error saving sessions: {e}")
    
    def get_all(self) -> List[Dict]:
        """Get all sessions as list"""
        return [
            {"id": sid, "title": session["title"]} 
            for sid, session in self.sessions.items()
        ]
    
    def get(self, session_id: str) -> Optional[Dict]:
        """Get specific session by ID"""
        return self.sessions.get(session_id)
    
    def create(self, prompt: str) -> str:
        """Create new session"""
        session_id = uuid.uuid4().hex[:8]
        self.sessions[session_id] = {
            "title": prompt[:30] + ("..." if len(prompt) > 30 else ""),
            "messages": []
        }
        return session_id
    
    def add_message(self, session_id: str, message: Dict):
        """Add message to session"""
        if session_id in self.sessions:
            self.sessions[session_id]["messages"].append(message)
    
    def update_message_status(self, message_id: str, status: str) -> bool:
        """Update message status (like/dislike)"""
        for session in self.sessions.values():
            for msg in session["messages"]:
                if msg.get("id") == message_id:
                    msg["status"] = status
                    return True
        return False
    
    def find_message_prompt(self, message_id: str) -> Optional[tuple]:
        """Find the original prompt for a message"""
        for sid, session in self.sessions.items():
            for i, msg in enumerate(session["messages"]):
                if msg.get("id") == message_id:
                    # Look for user message before this one
                    if i > 0 and session["messages"][i - 1]["sender"] == "user":
                        return sid, session["messages"][i - 1]["text"]
                    return sid, msg.get("text", "")
        return None
    
    def get_all_prompts(self, session_id: str) -> str:
        """Return concatenated all user prompts in this session."""
        session = self.sessions.get(session_id)
        if not session:
            return ""

        prompts = [
            msg.get("text", "")
            for msg in session["messages"]
            if msg.get("sender") == "user" and msg.get("text")
        ]

        return ". ".join(prompts)

# Initialize session manager
session_manager = SessionManager(Config.SESSIONS_FILE)

# ============================================
# Image Generation
# ============================================
class ImageGenerator:
    def __init__(self, base_pipeline, refiner_pipeline, output_dir: str):
        self.base_pipeline = base_pipeline
        self.refiner_pipeline = refiner_pipeline
        self.output_dir = output_dir
        os.makedirs(output_dir, exist_ok=True)
    
    def generate(self, prompt: str) -> str:
        """Generate image from prompt and return filename"""
        negative_prompt = "blurry, low quality, distorted, ugly"
        base_image = self.base_pipeline(prompt = prompt, negative_prompt = negative_prompt, 
                                        height = Config.IMAGE_SIZE, 
                                        width = Config.IMAGE_SIZE,
                                        num_inference_steps=40,
                                        guidance_scale=7.5,
                                        output_type="latent").images[0]
        image = self.refiner_pipeline(prompt = prompt, image = base_image,
                                      negative_prompt = negative_prompt,
                                      num_inference_steps=20,
                                      guidance_scale=7.5,
                                      strength=0.3).images[0]
        torch.cuda.empty_cache()
        filename = f"{uuid.uuid4().hex[:8]}.png"
        filepath = os.path.join(self.output_dir, filename)
        image.save(filepath)
        return f"generated/{filename}"

image_generator = ImageGenerator(pipe_base, pipe_refiner, Config.GENERATED_DIR)

# ============================================
# Routes
# ============================================
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/sessions", methods=["GET"])
def get_sessions():
    """Get list of all chat sessions"""
    return jsonify(session_manager.get_all())

@app.route("/session/<session_id>", methods=["GET"])
def get_session(session_id: str):
    """Get specific session content"""
    session = session_manager.get(session_id)
    if session:
        return jsonify(session)
    return jsonify({"messages": []}), 404

@app.route("/generate", methods=["POST"])
def generate_image():
    try:
        data = request.get_json()
        prompt_new = data.get("prompt", "").strip()
        session_id = data.get("session_id")

        print(f"\n=== NEW GENERATION REQUEST ===")
        print(f"Prompt: {prompt_new}")
        print(f"Session ID: {session_id}")

        if not prompt_new:
            return jsonify({"error": "Prompt is empty"}), 400

        # Handle session logic
        if session_id and session_manager.get(session_id):
            old_prompts = session_manager.get_all_prompts(session_id)
            prompt = (old_prompts + ". " + prompt_new) if old_prompts else prompt_new
            print(f"Using existing session. Full prompt: {prompt[:100]}...")
        else:
            # Create new session
            session_id = session_manager.create(prompt_new)
            prompt = prompt_new
            print(f"Created new session: {session_id}")

        # Generate image
        print("Calling image generator...")
        image_path = image_generator.generate(prompt)
        print(f"Image generation complete: {image_path}")

        # Create message IDs
        user_id = uuid.uuid4().hex[:8]
        bot_id = uuid.uuid4().hex[:8]
        boom_id = uuid.uuid4().hex[:8]

        print("Adding messages to session...")
        # Add user message
        session_manager.add_message(session_id, {
            "id": user_id,
            "sender": "user",
            "text": prompt_new
        })

        # Add bot message with image
        session_manager.add_message(session_id, {
            "id": bot_id,
            "sender": "bot",
            "image_url": f"/static/{image_path}",
            "text": f"Image is generated from prompt:\n{prompt}",
            "status": None
        })

        # Add completion message
        session_manager.add_message(session_id, {
            "id": boom_id,
            "sender": "bot",
            "text": "💥 Boom! Image is generated, do you want H&C to help you with anything else?"
        })

        print("Saving session...")
        session_manager.save()
        print("Session saved successfully")

        response = {
            "session_id": session_id,
            "image_url": f"/static/{image_path}",
            "message_id": bot_id
        }
        print(f"Returning response: {response}")
        return jsonify(response)

    except Exception as e:
        print(f"\n!!! ERROR in generate_image !!!")
        print(f"Error type: {type(e).__name__}")
        print(f"Error message: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Image generation failed: {str(e)}"}), 500


@app.route("/regenerate", methods=["POST"])
def regenerate():
    """Regenerate image from original prompt"""
    data = request.get_json()
    message_id = data.get("message_id")
    
    if not message_id:
        return jsonify({"error": "Missing message_id"}), 400
    
    # Find original prompt
    result = session_manager.find_message_prompt(message_id)
    if not result:
        return jsonify({"error": "Message not found"}), 404
    
    session_id, prompt = result
    if not prompt:
        return jsonify({"error": "No valid prompt found"}), 400
    
    # Generate new image
    try:
        image_path = image_generator.generate(prompt)
    except Exception as e:
        return jsonify({"error": f"Image generation failed: {str(e)}"}), 500
    
    # Create new message IDs
    new_user_id = uuid.uuid4().hex[:8]
    new_bot_id = uuid.uuid4().hex[:8]
    boom_id = uuid.uuid4().hex[:8]
    
    # Add messages
    session_manager.add_message(session_id, {
        "id": new_user_id,
        "sender": "user",
        "text": prompt
    })
    
    session_manager.add_message(session_id, {
        "id": new_bot_id,
        "sender": "bot",
        "image_url": f"/static/{image_path}",
        "text": prompt,
        "status": None
    })
    
    session_manager.add_message(session_id, {
        "id": boom_id,
        "sender": "bot",
        "text": "💥 Boom! Image is generated, do you want H&C to help you with anything else?"
    })
    
    session_manager.save()
    
    return jsonify({
        "session_id": session_id,
        "prompt": prompt,
        "image_url": f"/static/{image_path}",
        "message_id": new_bot_id
    })

@app.route("/static/generated/<path:filename>")
def serve_generated(filename: str):
    """Serve generated images"""
    return send_from_directory(Config.GENERATED_DIR, filename)

@app.route("/update_status", methods=["POST"])
def update_status():
    data = request.get_json()
    message_id = data.get("message_id")
    status = data.get("status")  # "like" hoặc "dislike"     

    if not message_id or not status:
        return jsonify({"error": "Missing message_id or status"}), 400

    ok = session_manager.update_message_status(message_id, status)

    if ok:
        session_manager.save()
        return jsonify({"success": True})
    else:
        return jsonify({"error": "Message not found"}), 404


# ============================================
# Application Entry Point
# ============================================
if __name__ == "__main__":
    # Ensure directories exist
    os.makedirs(Config.GENERATED_DIR, exist_ok=True)
    os.makedirs(Config.SOURCES_DIR, exist_ok=True)
    
    # app.run(port=Config.PORT, debug=Config.DEBUG) #window
    # ubuntu
    app.run(host="0.0.0.0", port=Config.PORT, debug=False)