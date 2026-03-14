// =====================================================
// CALENDAR PAGE - Shared State
// Global state variables and DOM element cache
// =====================================================

// Page state
let calendarInstance = null;
let currentView = 'month';
let selectedPost = null;
let activeBrandFilter = null; // null = All Brands, string = specific brand ID
let allBrands = []; // Cached list of all brands

// Best times state
let bestTimesOpen = false;
let bestTimesPlatform = 'youtube_shorts';
let bestTimesWindow = 30;

// DOM Elements cache
const calElements = {
    calendarContainer: null,
    calendarTitle: null,
    todayBtn: null,
    prevBtn: null,
    nextBtn: null,
    viewToggleBtns: null,
    platformFilter: null,
    statusFilter: null,
    postModal: null,
    postModalBody: null,
    createPostBtn: null,
    brandFilterBar: null
};

/**
 * Cache DOM element references
 */
function cacheElements() {
    calElements.calendarContainer = document.getElementById('calendar-container');
    calElements.calendarTitle = document.getElementById('calendar-title');
    calElements.todayBtn = document.getElementById('today-btn');
    calElements.prevBtn = document.getElementById('prev-btn');
    calElements.nextBtn = document.getElementById('next-btn');
    calElements.viewToggleBtns = document.querySelectorAll('.view-toggle__btn');
    calElements.platformFilter = document.getElementById('platform-filter');
    calElements.statusFilter = document.getElementById('status-filter');
    calElements.postModal = document.getElementById('post-modal');
    calElements.postModalBody = document.getElementById('post-modal-body');
    calElements.createPostBtn = document.getElementById('create-post-btn');
    calElements.brandFilterBar = document.getElementById('brand-filter-bar');
}
