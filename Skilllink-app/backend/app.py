from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
import hashlib
import os
import base64



# --- 1. CONFIGURATION ---
app = Flask(__name__)
# Use SQLite for quick setup
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///skilllink.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SECRET_KEY'] = 'your_super_secret_key' 

# Allow frontend running on port 5500 (Live Server) to talk to the backend on 8000
CORS(app, resources={r"/api/*": {"origins": ["http://127.0.0.1:5500", "http://localhost:5500"]}})
CORS(app, resources={r"/api/*": {"origins": "*"}})

db = SQLAlchemy(app)

# --- 2. DATABASE MODELS ---

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    role = db.Column(db.String(20), default='Job Seeker')
    company_name = db.Column(db.String(100), nullable=True)
    posted_jobs = db.relationship('Job', backref='employer', lazy=True)
    applications = db.relationship('Application', backref='applicant', lazy=True)

class Job(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(100), nullable=False)
    location = db.Column(db.String(50), nullable=False)
    description = db.Column(db.Text, nullable=False)
    employer_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)

class Application(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    job_id = db.Column(db.Integer, db.ForeignKey('job.id'), nullable=False)
    applicant_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    application_date = db.Column(db.DateTime, default=db.func.current_timestamp())
    resume_filename = db.Column(db.String(256))
    resume_data = db.Column(db.Text) 
    __table_args__ = (db.UniqueConstraint('job_id', 'applicant_id', name='_job_applicant_uc'),)


# --- 3. HELPER FUNCTIONS ---

def hash_password(password):
    return hashlib.sha256(password.encode('utf-8')).hexdigest()

def serialize_job(job, current_user_id=None):
    employer = User.query.get(job.employer_id)
    has_applied = False
    if current_user_id:
        has_applied = Application.query.filter_by(job_id=job.id, applicant_id=current_user_id).first() is not None
        
    return {
        'id': job.id,
        'title': job.title,
        'location': job.location,
        'description': job.description,
        'employer_id': job.employer_id,
        'employer_name': employer.username if employer else 'Unknown',
        'company_name': employer.company_name if employer else None,
        'has_applied': has_applied
    }

def get_auth_user(token):
    # Uses the password hash as a simple "token"
    try:
        return User.query.filter_by(password_hash=token).first()
    except:
        return None

# --- 4. API ROUTES ---

@app.route('/api/register', methods=['POST'])
def register():
    data = request.json
    hashed_password = hash_password(data['password'])
    
    if User.query.filter_by(email=data['email']).first():
        return jsonify({"message": "Email already registered"}), 409

    new_user = User(
        username=data['name'],
        email=data['email'],
        password_hash=hashed_password,
        role=data['role'],
        company_name=data.get('company_name') if data['role'] == 'Employer' else None
    )
    db.session.add(new_user)
    db.session.commit()
    return jsonify({"message": "Registration successful"}), 201

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    user = User.query.filter_by(email=data['email']).first()
    
    if user and user.password_hash == hash_password(data['password']):
        return jsonify({
            "token": user.password_hash, 
            "user": {
                "id": user.id, "name": user.username, "email": user.email, "role": user.role
            }
        }), 200
    return jsonify({"message": "Invalid email or password"}), 401

@app.route('/api/jobs', methods=['GET', 'POST'])
def jobs():
    auth_token = request.headers.get('Authorization', '').split('Token ')[-1]
    current_user = get_auth_user(auth_token)

    if request.method == 'GET':
        jobs_list = Job.query.all()
        user_id = current_user.id if current_user else None
        return jsonify([serialize_job(job, user_id) for job in jobs_list])

    elif request.method == 'POST':
        if not current_user or current_user.role != 'Employer':
            return jsonify({"message": "Unauthorized"}), 403

        data = request.json
        new_job = Job(
            title=data['title'], location=data['location'], description=data['description'], employer_id=current_user.id
        )
        db.session.add(new_job)
        db.session.commit()
        return jsonify({"message": "Job posted successfully", "job": serialize_job(new_job)}), 201

@app.route('/api/applications', methods=['POST'])
def apply():
    auth_token = request.headers.get('Authorization', '').split('Token ')[-1]
    current_user = get_auth_user(auth_token)
    
    if not current_user or current_user.role != 'Job Seeker':
        return jsonify({"message": "Unauthorized"}), 403

    job_id = request.form['job_id']
    file = request.files.get('resume')
    
    if not file:
         return jsonify({"message": "Resume file missing"}), 400

    resume_content = base64.b64encode(file.read()).decode('utf-8')
    
    if Application.query.filter_by(job_id=job_id, applicant_id=current_user.id).first():
        return jsonify({"message": "You have already applied for this job."}), 409

    new_app = Application(
        job_id=job_id, applicant_id=current_user.id, resume_filename=file.filename, resume_data=resume_content
    )
    db.session.add(new_app)
    db.session.commit()
    return jsonify({"message": "Application submitted successfully"}), 201

@app.route('/api/employer/jobs', methods=['GET'])
def employer_jobs():
    auth_token = request.headers.get('Authorization', '').split('Token ')[-1]
    current_user = get_auth_user(auth_token)
    
    if not current_user or current_user.role != 'Employer':
        return jsonify({"message": "Unauthorized"}), 403

    jobs_list = Job.query.filter_by(employer_id=current_user.id).all()
    response_data = []

    for job in jobs_list:
        applications = Application.query.filter_by(job_id=job.id).all()
        applicants_data = []
        
        for app in applications:
            applicant = User.query.get(app.applicant_id)
            applicants_data.append({
                'applicant_name': applicant.username,
                'applicant_email': applicant.email,
                'resume_filename': app.resume_filename,
                'resume_data': app.resume_data # This is the Base64 string for download
            })
            
        response_data.append({
            'id': job.id, 'title': job.title, 'location': job.location, 'description': job.description,
            'applications': applicants_data
        })
        
    return jsonify(response_data)


@app.route('/api/applications/me', methods=['GET'])
def user_applications():
    auth_token = request.headers.get('Authorization', '').split('Token ')[-1]
    current_user = get_auth_user(auth_token)
    
    if not current_user or current_user.role != 'Job Seeker':
        return jsonify({"message": "Unauthorized"}), 403

    apps = Application.query.filter_by(applicant_id=current_user.id).all()
    response_data = []
    
    for app in apps:
        job = Job.query.get(app.job_id)
        response_data.append({
            'job': { 'title': job.title, 'location': job.location, },
            'resume_filename': app.resume_filename,
        })
        
    return jsonify(response_data)


if __name__ == '__main__':
    with app.app_context():
        if not os.path.exists('skilllink.db'):
            db.create_all()
            print("Database 'skilllink.db' created.")
    app.run(debug=True, port=8000)