import { traineeApi } from '../api/traineeApi.js';
import { saveAuth, state } from '../utils/state.js';
import { showErrorToast, showSuccessToast } from '../utils/notify.js';

// === KARNATAKA CITIES DATABASE ===
const KARNATAKA_CITIES = [
    'Bagalkot', 'Ballari', 'Belagavi', 'Bengaluru', 'Bengaluru Rural',
    'Bidar', 'Chamarajanagar', 'Chikkaballapur', 'Chikkamagaluru',
    'Chitradurga', 'Dakshina Kannada', 'Davangere', 'Dharwad',
    'Gadag', 'Hassan', 'Haveri', 'Kalaburagi', 'Kodagu',
    'Kolar', 'Koppal', 'Mandya', 'Mysuru', 'Raichur',
    'Ramanagara', 'Shivamogga', 'Tumakuru', 'Udupi', 'Uttara Kannada',
    'Vijayapura', 'Yadgir'
];

// === ALL INDIAN STATES WITH CITIES MAP ===
const STATE_CITIES_MAP = {
    'Andhra Pradesh': ['Anantapur', 'Chittoor', 'East Godavari', 'Guntur', 'Krishna', 'Kurnool', 'Prakasam', 'Srikakulam', 'Visakhapatnam', 'Vizianagaram', 'West Godavari', 'YSR Kadapa'],
    'Arunachal Pradesh': ['Tawang', 'West Kameng', 'East Kameng', 'Papum Pare', 'Lower Subansiri', 'Upper Subansiri', 'West Siang', 'East Siang', 'Dibang Valley', 'Lohit', 'Changlang', 'Tirap'],
    'Assam': ['Barpeta', 'Bongaigaon', 'Cachar', 'Darrang', 'Dhemaji', 'Dibrugarh', 'Goalpara', 'Golaghat', 'Guwahati', 'Hailakandi', 'Jorhat', 'Kamrup', 'Karbi Anglong', 'Karimganj', 'Kokrajhar', 'Lakhimpur', 'Marigaon', 'Nagaon', 'Nalbari', 'Sivasagar', 'Sonitpur', 'Tinsukia', 'Udalguri'],
    'Bihar': ['Araria', 'Arwal', 'Aurangabad', 'Banka', 'Begusarai', 'Bhagalpur', 'Bhojpur', 'Buxar', 'Darbhanga', 'Gaya', 'Gopalganj', 'Jamui', 'Jehanabad', 'Kaimur', 'Katihar', 'Khagaria', 'Kishanganj', 'Lakhisarai', 'Madhepura', 'Madhubani', 'Munger', 'Muzaffarpur', 'Nalanda', 'Nawada', 'Patna', 'Purnia', 'Rohtas', 'Saharsa', 'Samastipur', 'Saran', 'Sheikhpura', 'Sheohar', 'Sitamarhi', 'Siwan', 'Supaul', 'Vaishali', 'West Champaran'],
    'Chhattisgarh': ['Balod', 'Baloda Bazar', 'Bastar', 'Bemetara', 'Bilaspur', 'Dantewada', 'Dhamtari', 'Durg', 'Gariaband', 'Janjgir-Champa', 'Jashpur', 'Kabirdham', 'Kanker', 'Kondagaon', 'Korba', 'Koriya', 'Mahasamund', 'Mungeli', 'Narayanpur', 'Raigarh', 'Raipur', 'Rajnandgaon', 'Sukma', 'Surajpur', 'Surguja'],
    'Goa': ['North Goa', 'South Goa'],
    'Gujarat': ['Ahmedabad', 'Amreli', 'Anand', 'Aravalli', 'Banaskantha', 'Bharuch', 'Bhavnagar', 'Botad', 'Chhota Udaipur', 'Dahod', 'Dang', 'Devbhoomi Dwarka', 'Gandhinagar', 'Gir Somnath', 'Jamnagar', 'Junagadh', 'Kheda', 'Kutch', 'Mahisagar', 'Mehsana', 'Morbi', 'Narmada', 'Navsari', 'Panchmahal', 'Patan', 'Porbandar', 'Rajkot', 'Sabarkantha', 'Surat', 'Surendranagar', 'Tapi', 'Vadodara', 'Valsad'],
    'Haryana': ['Ambala', 'Bhiwani', 'Charkhi Dadri', 'Faridabad', 'Fatehabad', 'Gurugram', 'Hisar', 'Jhajjar', 'Jind', 'Kaithal', 'Karnal', 'Kurukshetra', 'Mahendragarh', 'Nuh', 'Palwal', 'Panchkula', 'Panipat', 'Rewari', 'Rohtak', 'Sirsa', 'Sonipat', 'Yamunanagar'],
    'Himachal Pradesh': ['Bilaspur', 'Chamba', 'Hamirpur', 'Kangra', 'Kinnaur', 'Kullu', 'Lahaul and Spiti', 'Mandi', 'Shimla', 'Sirmaur', 'Solan', 'Una'],
    'Jharkhand': ['Bokaro', 'Chatra', 'Deoghar', 'Dhanbad', 'Dumka', 'East Singhbhum', 'Garhwa', 'Giridih', 'Godda', 'Gumla', 'Hazaribagh', 'Jamtara', 'Khunti', 'Koderma', 'Latehar', 'Lohardaga', 'Pakur', 'Palamu', 'Ramgarh', 'Ranchi', 'Sahebganj', 'Saraikela Kharsawan', 'Simdega', 'West Singhbhum'],
    'Karnataka': KARNATAKA_CITIES,
    'Kerala': ['Alappuzha', 'Ernakulam', 'Idukki', 'Kannur', 'Kasaragod', 'Kollam', 'Kottayam', 'Kozhikode', 'Malappuram', 'Palakkad', 'Pathanamthitta', 'Thiruvananthapuram', 'Thrissur', 'Wayanad'],
    'Madhya Pradesh': ['Agar Malwa', 'Alirajpur', 'Anuppur', 'Ashoknagar', 'Balaghat', 'Barwani', 'Betul', 'Bhind', 'Bhopal', 'Burhanpur', 'Chhatarpur', 'Chhindwara', 'Damoh', 'Datia', 'Dewas', 'Dhar', 'Dindori', 'Guna', 'Gwalior', 'Harda', 'Hoshangabad', 'Indore', 'Jabalpur', 'Jhabua', 'Katni', 'Khandwa', 'Khargone', 'Mandla', 'Mandsaur', 'Morena', 'Narsinghpur', 'Neemuch', 'Panna', 'Raisen', 'Rajgarh', 'Ratlam', 'Rewa', 'Sagar', 'Satna', 'Sehore', 'Seoni', 'Shahdol', 'Shajapur', 'Sheopur', 'Shivpuri', 'Sidhi', 'Singrauli', 'Tikamgarh', 'Ujjain', 'Umaria', 'Vidisha'],
    'Maharashtra': ['Ahmednagar', 'Akola', 'Amravati', 'Aurangabad', 'Beed', 'Bhandara', 'Buldhana', 'Chandrapur', 'Dhule', 'Gadchiroli', 'Gondia', 'Hingoli', 'Jalgaon', 'Jalna', 'Kolhapur', 'Latur', 'Mumbai City', 'Mumbai Suburban', 'Nagpur', 'Nanded', 'Nandurbar', 'Nashik', 'Osmanabad', 'Palghar', 'Parbhani', 'Pune', 'Raigad', 'Ratnagiri', 'Sangli', 'Satara', 'Sindhudurg', 'Solapur', 'Thane', 'Wardha', 'Washim', 'Yavatmal'],
    'Manipur': ['Bishnupur', 'Chandel', 'Churachandpur', 'Imphal East', 'Imphal West', 'Jiribam', 'Kakching', 'Kamjong', 'Kangpokpi', 'Noney', 'Pherzawl', 'Senapati', 'Tamenglong', 'Tengnoupal', 'Thoubal', 'Ukhrul'],
    'Meghalaya': ['East Garo Hills', 'East Jaintia Hills', 'East Khasi Hills', 'North Garo Hills', 'Ri Bhoi', 'South Garo Hills', 'South West Garo Hills', 'South West Khasi Hills', 'West Garo Hills', 'West Jaintia Hills', 'West Khasi Hills'],
    'Mizoram': ['Aizawl', 'Champhai', 'Hnahthial', 'Khawzawl', 'Kolasib', 'Lawngtlai', 'Lunglei', 'Mamit', 'Saiha', 'Saitual', 'Serchhip'],
    'Nagaland': ['Chümoukedima', 'Dimapur', 'Kiphire', 'Kohima', 'Longleng', 'Mokokchung', 'Mon', 'Niuland', 'Noklak', 'Peren', 'Phek', 'Shamator', 'Tseminyü', 'Tuensang', 'Wokha', 'Zünheboto'],
    'Odisha': ['Angul', 'Balangir', 'Balasore', 'Bargarh', 'Bhadrak', 'Boudh', 'Cuttack', 'Deogarh', 'Dhenkanal', 'Gajapati', 'Ganjam', 'Jagatsinghpur', 'Jajpur', 'Jharsuguda', 'Kalahandi', 'Kandhamal', 'Kendrapara', 'Kendujhar', 'Khordha', 'Koraput', 'Malkangiri', 'Mayurbhanj', 'Nabarangpur', 'Nayagarh', 'Nuapada', 'Puri', 'Rayagada', 'Sambalpur', 'Subarnapur', 'Sundergarh'],
    'Punjab': ['Amritsar', 'Barnala', 'Bathinda', 'Faridkot', 'Fatehgarh Sahib', 'Fazilka', 'Ferozepur', 'Gurdaspur', 'Hoshiarpur', 'Jalandhar', 'Kapurthala', 'Ludhiana', 'Mansa', 'Moga', 'Mohali', 'Muktsar', 'Nawanshahr', 'Pathankot', 'Patiala', 'Rupnagar', 'Sangrur', 'SAS Nagar', 'Tarn Taran'],
    'Rajasthan': ['Ajmer', 'Alwar', 'Banswara', 'Baran', 'Barmer', 'Bharatpur', 'Bhilwara', 'Bikaner', 'Bundi', 'Chittorgarh', 'Churu', 'Dausa', 'Dholpur', 'Dungarpur', 'Hanumangarh', 'Jaipur', 'Jaisalmer', 'Jalore', 'Jhalawar', 'Jhunjhunu', 'Jodhpur', 'Karauli', 'Kota', 'Nagaur', 'Pali', 'Pratapgarh', 'Rajsamand', 'Sawai Madhopur', 'Sikar', 'Sirohi', 'Sri Ganganagar', 'Tonk', 'Udaipur'],
    'Sikkim': ['East Sikkim', 'North Sikkim', 'South Sikkim', 'West Sikkim'],
    'Tamil Nadu': ['Ariyalur', 'Chengalpattu', 'Chennai', 'Coimbatore', 'Cuddalore', 'Dharmapuri', 'Dindigul', 'Erode', 'Kallakurichi', 'Kancheepuram', 'Karur', 'Krishnagiri', 'Madurai', 'Mayiladuthurai', 'Nagapattinam', 'Namakkal', 'Nilgiris', 'Perambalur', 'Pudukkottai', 'Ramanathapuram', 'Ranipet', 'Salem', 'Sivaganga', 'Tenkasi', 'Thanjavur', 'Theni', 'Thoothukudi', 'Tiruchirappalli', 'Tirunelveli', 'Tirupathur', 'Tiruppur', 'Tiruvallur', 'Tiruvannamalai', 'Tiruvarur', 'Vellore', 'Viluppuram', 'Virudhunagar'],
    'Telangana': ['Adilabad', 'Bhadradri Kothagudem', 'Hyderabad', 'Jagtial', 'Jangaon', 'Jayashankar Bhupalpally', 'Jogulamba Gadwal', 'Kamareddy', 'Karimnagar', 'Khammam', 'Kumuram Bheem', 'Mahabubabad', 'Mahabubnagar', 'Mancherial', 'Medak', 'Medchal', 'Mulugu', 'Nagarkurnool', 'Nalgonda', 'Narayanpet', 'Nirmal', 'Nizamabad', 'Peddapalli', 'Rajanna Sircilla', 'Ranga Reddy', 'Sangareddy', 'Siddipet', 'Suryapet', 'Vikarabad', 'Wanaparthy', 'Warangal', 'Yadadri Bhuvanagiri'],
    'Tripura': ['Dhalai', 'Gomati', 'Khowai', 'North Tripura', 'Sepahijala', 'South Tripura', 'Unakoti', 'West Tripura'],
    'Uttar Pradesh': ['Agra', 'Aligarh', 'Ambedkar Nagar', 'Amethi', 'Amroha', 'Auraiya', 'Ayodhya', 'Azamgarh', 'Baghpat', 'Bahraich', 'Ballia', 'Balrampur', 'Banda', 'Barabanki', 'Bareilly', 'Basti', 'Bhadohi', 'Bijnor', 'Budaun', 'Bulandshahr', 'Chandauli', 'Chitrakoot', 'Deoria', 'Etah', 'Etawah', 'Farrukhabad', 'Fatehpur', 'Firozabad', 'Gautam Buddh Nagar', 'Ghaziabad', 'Ghazipur', 'Gonda', 'Gorakhpur', 'Hamirpur', 'Hapur', 'Hardoi', 'Hathras', 'Jalaun', 'Jaunpur', 'Jhansi', 'Kannauj', 'Kanpur Dehat', 'Kanpur Nagar', 'Kasganj', 'Kaushambi', 'Kheri', 'Kushinagar', 'Lalitpur', 'Lucknow', 'Maharajganj', 'Mahoba', 'Mainpuri', 'Mathura', 'Mau', 'Meerut', 'Mirzapur', 'Moradabad', 'Muzaffarnagar', 'Pilibhit', 'Pratapgarh', 'Prayagraj', 'Raebareli', 'Rampur', 'Saharanpur', 'Sambhal', 'Sant Kabir Nagar', 'Shahjahanpur', 'Shamli', 'Shravasti', 'Siddharthnagar', 'Sitapur', 'Sonbhadra', 'Sultanpur', 'Unnao', 'Varanasi'],
    'Uttarakhand': ['Almora', 'Bageshwar', 'Chamoli', 'Champawat', 'Dehradun', 'Haridwar', 'Nainital', 'Pauri Garhwal', 'Pithoragarh', 'Rudraprayag', 'Tehri Garhwal', 'Udham Singh Nagar', 'Uttarkashi'],
    'West Bengal': ['Alipurduar', 'Bankura', 'Birbhum', 'Cooch Behar', 'Dakshin Dinajpur', 'Darjeeling', 'Hooghly', 'Howrah', 'Jalpaiguri', 'Jhargram', 'Kalimpong', 'Kolkata', 'Malda', 'Murshidabad', 'Nadia', 'North 24 Parganas', 'Paschim Bardhaman', 'Paschim Medinipur', 'Purba Bardhaman', 'Purba Medinipur', 'Purulia', 'South 24 Parganas', 'Uttar Dinajpur']
};

class TraineeAuthModal {
    constructor() {
        this.modal = document.getElementById('trainee-auth-modal');
        this.bindEvents();
        this.currentView = null;
        this.onSuccessCallback = null;
        this._activeMethod = 'email'; // 'email' | 'phone'
        this._pendingEmail = null;
        this._pendingPhone = null;
        this._initStateCity();
    }

    _initStateCity() {
        const stateSelect = document.getElementById('trainee-signup-state');
        const citySelect = document.getElementById('trainee-signup-city');

        if (stateSelect && citySelect) {
            stateSelect.addEventListener('change', () => {
                const selectedState = stateSelect.value;
                citySelect.innerHTML = '<option value="">Select City</option>';
                citySelect.disabled = true;

                if (selectedState && STATE_CITIES_MAP[selectedState]) {
                    const cities = STATE_CITIES_MAP[selectedState];
                    citySelect.disabled = false;
                    cities.forEach(city => {
                        const opt = document.createElement('option');
                        opt.value = city;
                        opt.textContent = city;
                        citySelect.appendChild(opt);
                    });
                }
            });

            citySelect.disabled = true;
        }
    }

    /** Redirect to signup, pre-filling any known fields */
    _redirectToSignup(email, phone) {
        if (email) {
            const el = document.getElementById('trainee-signup-email');
            if (el) el.value = email;
        }
        if (phone) {
            const el = document.getElementById('trainee-signup-phone');
            if (el) el.value = phone.replace(/^\+91/, '').replace(/\D/g, '');
        }
        showSuccessToast('You need to register first! Fill in your details to continue.');
        this.showSignup();
    }

    /** Check backend response for needsSignup. Returns true if redirected to signup. */
    _checkNeedsSignup(data, email, phone) {
        if (data && data.needsSignup === true) {
            this._redirectToSignup(email, phone);
            return true;
        }
        return false;
    }

    bindEvents() {
        document.getElementById('btn-close-trainee-auth')
            ?.addEventListener('click', () => this.close());

        document.getElementById('btn-trainee-phone')
            ?.addEventListener('click', () => this.showPhoneView());
        document.getElementById('btn-trainee-email')
            ?.addEventListener('click', () => this.showEmailView());

        document.getElementById('link-trainee-back-phone')
            ?.addEventListener('click', (e) => { e.preventDefault(); this.showLogin(); });
        document.getElementById('link-trainee-back-email')
            ?.addEventListener('click', (e) => { e.preventDefault(); this.showLogin(); });

        document.getElementById('trainee-phone-form')
            ?.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handlePhoneOtpRequest();
            });

        document.getElementById('trainee-email-form')
            ?.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleEmailOtpRequest();
            });

        document.getElementById('trainee-signup-form')
            ?.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleSignup();
            });

        document.getElementById('trainee-verify-form')
            ?.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleVerifyOtp();
            });

        document.getElementById('link-trainee-to-signup')
            ?.addEventListener('click', (e) => {
                e.preventDefault();
                this.showSignup();
            });

        document.getElementById('link-trainee-to-login')
            ?.addEventListener('click', (e) => {
                e.preventDefault();
                this.showLogin();
            });

        document.getElementById('link-trainee-back-verify')
            ?.addEventListener('click', (e) => {
                e.preventDefault();
                this.showLogin();
            });

        document.getElementById('link-trainee-success-login')
            ?.addEventListener('click', (e) => {
                e.preventDefault();
                this.showLogin();
            });
    }

    open(onSuccess = null) {
        if (state.token && state.user && state.user.role === 'trainee') {
            if (onSuccess) onSuccess();
            return;
        }
        if (state.token && state.user && state.user.role !== 'trainee') {
            showErrorToast('Your current account is not registered as a trainee. Please register as a trainee to access training.');
        }
        this.onSuccessCallback = onSuccess;
        this.showLogin();
        this.modal.classList.add('open');
        this.clearErrors();
    }

    close() {
        this.modal.classList.remove('open');
        this.clearErrors();
        this.clearForms();
    }

    showLogin() {
        this._activeMethod = null;
        this._hideAllViews();
        document.getElementById('trainee-login-view').classList.remove('hidden');
        this.currentView = 'login';
    }

    showPhoneView() {
        this._activeMethod = 'phone';
        this._hideAllViews();
        document.getElementById('trainee-phone-view').classList.remove('hidden');
        this.currentView = 'phone';
        document.getElementById('trainee-phone')?.focus();
    }

    showEmailView() {
        this._activeMethod = 'email';
        this._hideAllViews();
        document.getElementById('trainee-email-request-view').classList.remove('hidden');
        this.currentView = 'email';
        document.getElementById('trainee-email-input')?.focus();
    }

    showSignup() {
        this._hideAllViews();
        document.getElementById('trainee-signup-view').classList.remove('hidden');
        this.currentView = 'signup';
    }

    showVerify(contact) {
        this._hideAllViews();
        document.getElementById('trainee-verify-view').classList.remove('hidden');
        this.currentView = 'verify';
        const subtitle = document.getElementById('trainee-verify-subtitle');
        if (subtitle) subtitle.textContent = `Enter the 6-digit code sent to ${contact}`;
        document.getElementById('trainee-otp')?.focus();
    }

    showSignupSuccess() {
        this._hideAllViews();
        document.getElementById('trainee-success-view').classList.remove('hidden');
        this.currentView = 'success';
    }

    _hideAllViews() {
        ['trainee-login-view', 'trainee-signup-view', 'trainee-verify-view', 'trainee-success-view',
            'trainee-phone-view', 'trainee-email-request-view'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.classList.add('hidden');
            });
    }

    clearErrors() {
        ['trainee-login-error', 'trainee-signup-error', 'trainee-verify-error',
            'trainee-phone-error', 'trainee-email-error'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.classList.add('hidden');
            });
    }

    clearForms() {
        ['trainee-login-form', 'trainee-signup-form', 'trainee-verify-form',
            'trainee-phone-form', 'trainee-email-form'].forEach(id => {
                const form = document.getElementById(id);
                if (form) form.reset();
            });
    }

    // ======================
    // PHONE OTP LOGIN
    // ======================
    async handlePhoneOtpRequest() {
        const phone = document.getElementById('trainee-phone')?.value.trim();
        const country = document.getElementById('trainee-phone-country')?.value || '+91';
        const fullPhone = `${country}${phone}`;
        const errorEl = document.getElementById('trainee-phone-error');

        if (!phone || phone.length < 8) {
            if (errorEl) { errorEl.textContent = 'Please enter a valid phone number.'; errorEl.classList.remove('hidden'); }
            return;
        }

        const btn = document.querySelector('#trainee-phone-form button');
        if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }

        try {
            const data = await traineeApi.requestPhoneOtp(fullPhone);

            // If user not registered → redirect to signup with phone pre-filled
            if (this._checkNeedsSignup(data, null, fullPhone)) {
                return;
            }

            // User exists — data.email is their real email from backend
            this._pendingPhone = fullPhone;
            this._pendingEmail = data.email || null;
            errorEl?.classList.add('hidden');
            showSuccessToast('OTP sent to your registered email!');
            this.showVerify(fullPhone);
        } catch (err) {
            if (errorEl) { errorEl.textContent = err.message || 'Failed to process phone number.'; errorEl.classList.remove('hidden'); }
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Send OTP'; }
        }
    }

    // ======================
    // EMAIL OTP LOGIN
    // ======================
    async handleEmailOtpRequest() {
        const email = document.getElementById('trainee-email-input')?.value.trim();
        const errorEl = document.getElementById('trainee-email-error');

        if (!email) {
            if (errorEl) { errorEl.textContent = 'Please enter your email.'; errorEl.classList.remove('hidden'); }
            return;
        }

        const btn = document.querySelector('#trainee-email-form button');
        if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }

        try {
            const data = await traineeApi.requestOtp(email);

            // If user not registered → redirect to signup with email pre-filled
            if (this._checkNeedsSignup(data, email, null)) {
                return;
            }

            // User exists — proceed to OTP verify
            errorEl?.classList.add('hidden');
            showSuccessToast('OTP sent to your email!');
            this._pendingEmail = email;
            this.showVerify(email);
        } catch (err) {
            if (errorEl) { errorEl.textContent = err.message || 'Failed to send OTP.'; errorEl.classList.remove('hidden'); }
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Get Access Code'; }
        }
    }

    // ======================
    // SIGNUP
    // ======================
    async handleSignup() {
        const fullName = document.getElementById('trainee-signup-name')?.value.trim();
        const phone = document.getElementById('trainee-signup-phone')?.value.trim();
        const email = document.getElementById('trainee-signup-email')?.value.trim();
        const roleType = document.getElementById('trainee-signup-role')?.value;
        const stateVal = document.getElementById('trainee-signup-state')?.value;
        const city = document.getElementById('trainee-signup-city')?.value;
        const errorEl = document.getElementById('trainee-signup-error');

        if (!fullName || !phone || !email || !roleType || !stateVal || !city) {
            if (errorEl) { errorEl.textContent = 'All fields are required.'; errorEl.classList.remove('hidden'); }
            return;
        }

        if (phone.length < 10) {
            if (errorEl) { errorEl.textContent = 'Please enter a valid 10-digit phone number.'; errorEl.classList.remove('hidden'); }
            return;
        }

        const btn = document.querySelector('#trainee-signup-form button');
        if (btn) { btn.disabled = true; btn.textContent = 'Registering...'; }

        try {
            await traineeApi.signup({ fullName, phone, email, roleType, city, state: stateVal });
            showSuccessToast('Registration successful! Please login.');
            this.showSignupSuccess();
        } catch (err) {
            if (errorEl) { errorEl.textContent = err.message || 'Registration failed. Please try again.'; errorEl.classList.remove('hidden'); }
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Register & Continue'; }
        }
    }

    // ======================
    // VERIFY OTP
    // ======================
    async handleVerifyOtp() {
        const otp = document.getElementById('trainee-otp')?.value.trim();
        const errorEl = document.getElementById('trainee-verify-error');

        if (!otp || otp.length < 4) {
            if (errorEl) { errorEl.textContent = 'Please enter the 6-digit OTP code.'; errorEl.classList.remove('hidden'); }
            return;
        }

        const btn = document.querySelector('#trainee-verify-form button');
        if (btn) { btn.disabled = true; btn.textContent = 'Verifying...'; }

        try {
            let data;

            if (this._activeMethod === 'phone') {
                // Phone: verify using phone number (backend looks up user by phone)
                data = await traineeApi.verifyPhoneOtp(this._pendingPhone, otp);
            } else {
                // Email: verify using email address
                data = await traineeApi.verifyOtp(this._pendingEmail, otp);
            }

            saveAuth(data.token, data.user);
            this.close();
            window.dispatchEvent(new Event('auth:changed'));
            showSuccessToast('Welcome back, Trainee!');
            if (this.onSuccessCallback) this.onSuccessCallback();
        } catch (err) {
            if (errorEl) { errorEl.textContent = err.message || 'OTP verification failed.'; errorEl.classList.remove('hidden'); }
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Verify & Login'; }
        }
    }
}

// Lazy singleton
let _traineeAuthModalInstance = null;
export const traineeAuthModal = {
    open: (onSuccess) => {
        if (!_traineeAuthModalInstance) _traineeAuthModalInstance = new TraineeAuthModal();
        _traineeAuthModalInstance.open(onSuccess);
    },
    close: () => {
        if (_traineeAuthModalInstance) _traineeAuthModalInstance.close();
    },
};