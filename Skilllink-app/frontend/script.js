// --- CONFIGURATION ---
// CHANGED: Using relative path '/api' since Flask now serves both the frontend and backend 
const API_BASE_URL = '/api'; 
let currentUser = null; 

// Simple utility for making API calls
async function apiFetch(endpoint, method = 'GET', body = null, isFormData = false) {
    const token = localStorage.getItem('authToken');
    const headers = {};

    if (!isFormData) {
        headers['Content-Type'] = 'application/json';
    }
    
    if (token) {
        headers['Authorization'] = `Token ${token}`;
    }

    const config = {
        method: method,
        headers: headers,
    };

    if (body) {
        config.body = isFormData ? body : JSON.stringify(body);
    }

    try {
        // FIXED: Using relative path and no trailing slash
        const response = await fetch(`${API_BASE_URL}/${endpoint}`, config); 
        
        if (response.status === 204) return null; 
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || errorData.detail || 'API request failed.');
        }

        return response.json();
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

// helper: escape HTML for security
function escapeHTML(str) {
    return String(str)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

// --- AUTHENTICATION HANDLERS ---

async function handleRegister(e) {
    e.preventDefault();
    const name = document.getElementById('name').value.trim();
    const email = document.getElementById('email').value.trim().toLowerCase();
    const password = document.getElementById('password').value;
    const role = document.getElementById('role').value;
    const company_name = document.getElementById('company_name')?.value.trim(); 

    try {
        await apiFetch('register', 'POST', { name, email, password, role, company_name });
        alert('Registration successful! Please log in.');
        window.location.href = 'login.html';
    } catch (error) {
        alert('Registration failed: ' + error.message);
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('email').value.trim().toLowerCase();
    const password = document.getElementById('password').value;

    try {
        const data = await apiFetch('login', 'POST', { email, password });
        
        localStorage.setItem('authToken', data.token);
        localStorage.setItem('currentUser', JSON.stringify(data.user));

        currentUser = data.user; 
        
        window.location.href = currentUser.role === 'Employer' ? 'employer.html' : 'dashboard.html';
    } catch (error) {
        alert('Login failed: Invalid email or password.');
    }
}

function handleLogout() {
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUser');
    currentUser = null;
    window.location.href = 'index.html';
}

// --- UI & NAVIGATION ---

function updateNav() {
    const navLinks = document.getElementById('nav-links');
    currentUser = JSON.parse(localStorage.getItem('currentUser'));

    if (currentUser && localStorage.getItem('authToken')) {
        if (currentUser.role === 'Employer') {
            navLinks.innerHTML = `
                <a href="employer.html">Dashboard</a>
                <a href="#" id="logout-btn">Logout (${escapeHTML(currentUser.name)})</a>
            `;
        } else {
            navLinks.innerHTML = `
                <a href="jobs.html">Jobs</a>
                <a href="dashboard.html">Dashboard</a>
                <a href="#" id="logout-btn">Logout (${escapeHTML(currentUser.name)})</a>
            `;
        }
        document.getElementById('logout-btn').addEventListener('click', handleLogout);
    } else {
        navLinks.innerHTML = `
            <a href="jobs.html">Jobs</a>
            <a href="login.html">Login</a>
            <a href="register.html">Register</a>
        `;
    }
}

// --- JOB SEEKER PAGE LOGIC ---

async function initJobsPage() {
    const jobListings = document.getElementById('job-listings');
    jobListings.innerHTML = '<p>Loading jobs...</p>'; 

    try {
        const jobs = await apiFetch('jobs'); 

        if (jobs.length === 0) {
            jobListings.innerHTML = '<p>No jobs posted yet. Check back later!</p>';
            return;
        }

        jobListings.innerHTML = jobs.map(job => {
            let applySectionHtml = '';
            
            if (currentUser && currentUser.role === 'Job Seeker') {
                if (job.has_applied) {
                    applySectionHtml = `<button class="btn-applied" disabled>Applied</button>`;
                } else {
                    applySectionHtml = `
                        <form class="apply-form" onsubmit="handleApply(event, ${job.id})">
                            <input type="file" class="resume-input" required accept=".pdf,.doc,.docx" aria-label="Upload Resume">
                            <button type="submit" class="btn-apply">Apply with Resume</button>
                        </form>`;
                }
            } else if (!currentUser) {
                applySectionHtml = `<p><a href="login.html">Login</a> to apply.</p>`;
            } else if (currentUser.role === 'Employer') {
                 applySectionHtml = `<p>Employers cannot apply for jobs.</p>`;
            }

            return `
                <div class="job-card" style="border: 1px solid #ccc; padding: 10px; margin-bottom: 10px;">
                    <h3>${escapeHTML(job.title)}</h3>
                    <p><strong>Company:</strong> ${escapeHTML(job.company_name || job.employer_name || 'Unknown')}</p>
                    <p><strong>Location:</strong> ${escapeHTML(job.location)}</p>
                    <p>${escapeHTML(job.description)}</p>
                    ${applySectionHtml} 
                </div>`;
        }).join('');
    } catch (error) {
        jobListings.innerHTML = `<p class="error" style="color: red;">Failed to load jobs: ${error.message}</p>`;
    }
}

async function initDashboardPage() {
    if (!currentUser || currentUser.role !== 'Job Seeker') {
        window.location.href = 'login.html'; 
        return;
    }
    
    document.getElementById('welcome-message').textContent = `Welcome back, ${escapeHTML(currentUser.name)}!`;
    const myApplicationsList = document.getElementById('my-applications-list');
    myApplicationsList.innerHTML = '<p>Loading applications...</p>';

    try {
        const myApps = await apiFetch('applications/me');

        if (myApps.length === 0) {
            myApplicationsList.innerHTML = '<p>You have not applied to any jobs yet.</p>';
            return;
        }
        
        myApplicationsList.innerHTML = myApps.map(app => {
            return `
                <div class="job-card" style="border: 1px solid #ddd; padding: 10px; margin-bottom: 10px;">
                    <h3>${escapeHTML(app.job.title)}</h3>
                    <p><strong>Location:</strong> ${escapeHTML(app.job.location)}</p>
                    <p><strong>Status:</strong> Submitted</p>
                    <p><strong>Resume:</strong> ${escapeHTML(app.resume_filename)}</p>
                </div>`;
        }).join('');
    } catch (error) {
        myApplicationsList.innerHTML = `<p class="error" style="color: red;">Failed to load applications: ${error.message}</p>`;
    }
}

// Global function for form submission (called by onsubmit in jobs.html)
window.handleApply = async function(event, jobId) {
    event.preventDefault();

    if (!currentUser || currentUser.role !== 'Job Seeker') {
        alert('Error: Not logged in or incorrect role.');
        return;
    }

    const fileInput = event.target.querySelector('.resume-input');
    const file = fileInput.files[0];

    if (!file) {
        alert('Please select a resume file to apply.');
        return;
    }

    // Use FormData to correctly package the file for the Flask backend
    const formData = new FormData();
    formData.append('job_id', jobId);
    formData.append('resume', file); 

    try {
        await apiFetch('applications', 'POST', formData, true); 
        
        alert('Application submitted successfully!');
        initJobsPage(); // Refresh the list to show 'Applied' button
    } catch (error) {
        alert('Application submission failed: ' + error.message);
    }
}


// --- EMPLOYER PAGE LOGIC ---

async function initEmployerPage() {
    if (!currentUser || currentUser.role !== 'Employer') {
        window.location.href = 'login.html'; 
        return;
    }
    
    // NOTE: This relies on the 'welcome-message' ID being in employer.html
    document.getElementById('welcome-message').textContent = `Welcome, Employer ${escapeHTML(currentUser.name)}!`;

    const postedJobsList = document.getElementById('posted-jobs-list');
    postedJobsList.innerHTML = '<p>Loading posted jobs and applicants...</p>';

    try {
        const employerJobs = await apiFetch('employer/jobs'); 

        if (employerJobs.length === 0) {
            postedJobsList.innerHTML = '<p>You have not posted any jobs yet.</p>';
            return;
        }

        postedJobsList.innerHTML = employerJobs.map(job => {
            const applicants = job.applications || [];
            let applicantsHtml = '<p>No applicants yet.</p>';

            if (applicants.length > 0) {
                applicantsHtml = '<ul>' + applicants.map(app => {
                    // Create download link using the Base64 data received from Flask
                    const downloadLink = app.resume_data 
                        ? `<a href="data:application/pdf;base64,${app.resume_data}" download="${app.resume_filename}" style="color: blue; margin-left: 10px;">Download Resume</a>` 
                        : '<span>No Resume Uploaded</span>';

                    return `<li><span>${escapeHTML(app.applicant_name)} (${escapeHTML(app.applicant_email)})</span> ${downloadLink}</li>`;
                }).join('') + '</ul>';
            }

            return `
                <div class="job-card" style="border: 1px solid #007bff; padding: 15px; margin-bottom: 20px;">
                    <h3>${escapeHTML(job.title)} (${applicants.length} Applicants)</h3>
                    <p><strong>Location:</strong> ${escapeHTML(job.location)}</p>
                    <div class="applicants-section">
                        <h4>Applicants:</h4>
                        ${applicantsHtml}
                    </div>
                </div>`;
        }).join('');

    } catch (error) {
        postedJobsList.innerHTML = `<p class="error" style="color: red;">Failed to load employer data: ${error.message}</p>`;
    }
}

async function handlePostJob(e) {
    e.preventDefault();
    const title = document.getElementById('job-title').value;
    const location = document.getElementById('job-location').value;
    const description = document.getElementById('job-description').value;

    try {
        await apiFetch('jobs', 'POST', { title, location, description });
        
        alert('Job posted successfully!');
        e.target.reset(); // Clear form
        initEmployerPage(); // Refresh the job list
    } catch (error) {
        alert('Failed to post job: ' + error.message);
    }
}


// --- GLOBAL INITIALIZATION ---

document.addEventListener('DOMContentLoaded', () => {
    // 1. Update the navigation bar (login/logout/dashboard links)
    updateNav();
    
    // 2. Run page-specific logic based on the <body> ID
    if (document.body.id === 'jobs-page') initJobsPage();
    if (document.body.id === 'dashboard-page') initDashboardPage();
    if (document.body.id === 'employer-page') initEmployerPage();

    // 3. Attach event listeners to forms
    const loginForm = document.getElementById('login-form');
    if (loginForm) loginForm.addEventListener('submit', handleLogin);

    const registerForm = document.getElementById('register-form');
    if (registerForm) registerForm.addEventListener('submit', handleRegister);
    
    const postJobForm = document.getElementById('post-job-form');
    if (postJobForm) postJobForm.addEventListener('submit', handlePostJob);
});