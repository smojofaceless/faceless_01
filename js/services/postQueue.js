/**
 * Post Queue Service
 * Manages the queue of posts for scheduling and auto-posting
 * SUPABASE-INTEGRATED: Posts stored in Supabase database
 */

class PostQueueService {
    constructor() {
        this.useSupabase = false;
        this.posts = new Map();
        this.listeners = new Map();
        this.initialized = false;
        
        // Status constants
        this.STATUS = {
            DRAFT: 'draft',
            APPROVED: 'approved',
            SCHEDULED: 'scheduled',
            POSTING: 'posting',
            POSTED: 'posted',
            FAILED: 'failed',
            CANCELLED: 'cancelled'
        };
    }

    /**
     * Initialize the post queue service
     */
    async init() {
        if (this.initialized) return;
        
        this.useSupabase = typeof supabaseClient !== 'undefined' && supabaseClient !== null;
        
        if (this.useSupabase) {
            console.log('📮 PostQueueService: Using Supabase storage');
        } else {
            console.log('📮 PostQueueService: Using localStorage fallback');
            this.loadFromLocalStorage();
        }
        
        this.initialized = true;
    }

    // ==================== CRUD Operations ====================

    /**
     * Add a post to the queue
     * @param {Object} postData - Post data
     * @returns {Promise<Object>} Created post
     */
    async addPost(postData) {
        const post = {
            id: postData.id || crypto.randomUUID(),
            brand_id: postData.brandId || postData.brand_id,
            video_url: postData.videoUrl || postData.video_url,
            video_storage_path: postData.videoStoragePath || postData.video_storage_path,
            thumbnail_url: postData.thumbnailUrl || postData.thumbnail_url,
            duration_seconds: postData.duration || postData.duration_seconds,
            title: postData.title,
            description: postData.description || '',
            tags: postData.tags || [],
            theme: postData.theme,
            niche: postData.niche,
            generation_batch_id: postData.batchId || postData.generation_batch_id,
            platforms: postData.platforms || ['youtube'],
            status: postData.status || this.STATUS.DRAFT,
            scheduled_at: postData.scheduledAt || postData.scheduled_at,
            posted_at: null,
            platform_results: {},
            error_message: null,
            retry_count: 0,
            ai_metadata: postData.aiMetadata || postData.ai_metadata || {},
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        if (this.useSupabase) {
            try {
                const { data, error } = await supabaseClient
                    .from('posts')
                    .insert(post)
                    .select()
                    .single();

                if (error) throw error;
                console.log('📮 Post added to queue:', data.id);
                this.emit('post:added', data);
                return data;
            } catch (e) {
                console.error('Failed to add post to Supabase:', e);
                throw e;
            }
        } else {
            this.posts.set(post.id, post);
            this.saveToLocalStorage();
            this.emit('post:added', post);
            return post;
        }
    }

    /**
     * Get a post by ID
     * @param {string} id - Post ID
     * @returns {Promise<Object|null>}
     */
    async getPost(id) {
        if (this.useSupabase) {
            const { data, error } = await supabaseClient
                .from('posts')
                .select('*')
                .eq('id', id)
                .single();
            
            if (error) {
                console.error('Failed to get post:', error);
                return null;
            }
            return data;
        }
        return this.posts.get(id) || null;
    }

    /**
     * Update a post
     * @param {string} id - Post ID
     * @param {Object} updates - Fields to update
     * @returns {Promise<Object>}
     */
    async updatePost(id, updates) {
        updates.updated_at = new Date().toISOString();

        if (this.useSupabase) {
            const { data, error } = await supabaseClient
                .from('posts')
                .update(updates)
                .eq('id', id)
                .select()
                .single();

            if (error) throw error;
            this.emit('post:updated', data);
            return data;
        } else {
            const post = this.posts.get(id);
            if (!post) throw new Error('Post not found');
            Object.assign(post, updates);
            this.saveToLocalStorage();
            this.emit('post:updated', post);
            return post;
        }
    }

    /**
     * Delete a post
     * @param {string} id - Post ID
     */
    async deletePost(id) {
        if (this.useSupabase) {
            const { error } = await supabaseClient
                .from('posts')
                .delete()
                .eq('id', id);

            if (error) throw error;
        } else {
            this.posts.delete(id);
            this.saveToLocalStorage();
        }
        this.emit('post:deleted', { id });
    }

    // ==================== Query Operations ====================

    /**
     * Get all posts for a brand
     * @param {string} brandId - Brand ID
     * @param {Object} options - Query options
     * @returns {Promise<Object[]>}
     */
    async getPostsByBrand(brandId, options = {}) {
        const { status, limit = 50, orderBy = 'created_at', order = 'desc' } = options;

        if (this.useSupabase) {
            let query = supabaseClient
                .from('posts')
                .select('*')
                .eq('brand_id', brandId)
                .order(orderBy, { ascending: order === 'asc' })
                .limit(limit);

            if (status) {
                if (Array.isArray(status)) {
                    query = query.in('status', status);
                } else {
                    query = query.eq('status', status);
                }
            }

            const { data, error } = await query;
            if (error) throw error;
            return data || [];
        } else {
            let posts = Array.from(this.posts.values())
                .filter(p => p.brand_id === brandId);
            
            if (status) {
                const statuses = Array.isArray(status) ? status : [status];
                posts = posts.filter(p => statuses.includes(p.status));
            }
            
            return posts.slice(0, limit);
        }
    }

    /**
     * Get posts pending for auto-posting (scheduled and due)
     * @returns {Promise<Object[]>}
     */
    async getPendingPosts() {
        const now = new Date().toISOString();

        if (this.useSupabase) {
            const { data, error } = await supabaseClient
                .from('posts')
                .select('*')
                .eq('status', this.STATUS.SCHEDULED)
                .lte('scheduled_at', now)
                .lt('retry_count', 3)
                .order('scheduled_at', { ascending: true })
                .limit(10);

            if (error) throw error;
            return data || [];
        } else {
            return Array.from(this.posts.values())
                .filter(p => 
                    p.status === this.STATUS.SCHEDULED && 
                    p.scheduled_at && 
                    new Date(p.scheduled_at) <= new Date() &&
                    p.retry_count < 3
                )
                .slice(0, 10);
        }
    }

    /**
     * Get upcoming scheduled posts
     * @param {string} brandId - Brand ID (optional)
     * @param {number} days - Number of days ahead to look
     */
    async getUpcomingPosts(brandId = null, days = 7) {
        const now = new Date();
        const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

        if (this.useSupabase) {
            let query = supabaseClient
                .from('posts')
                .select('*')
                .eq('status', this.STATUS.SCHEDULED)
                .gte('scheduled_at', now.toISOString())
                .lte('scheduled_at', future.toISOString())
                .order('scheduled_at', { ascending: true });

            if (brandId) {
                query = query.eq('brand_id', brandId);
            }

            const { data, error } = await query;
            if (error) throw error;
            return data || [];
        } else {
            return Array.from(this.posts.values())
                .filter(p => 
                    p.status === this.STATUS.SCHEDULED &&
                    p.scheduled_at &&
                    new Date(p.scheduled_at) >= now &&
                    new Date(p.scheduled_at) <= future &&
                    (!brandId || p.brand_id === brandId)
                )
                .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
        }
    }

    /**
     * Get all posts in a date range (for calendar view)
     * Unlike getUpcomingPosts, this returns ALL statuses and supports past dates
     * @param {Date} start - Range start
     * @param {Date} end - Range end  
     * @param {Object} filters - Optional filters { brandId, status, platformId }
     * @returns {Promise<Object[]>}
     */
    async getPostsInRange(start, end, filters = {}) {
        if (this.useSupabase) {
            let query = supabaseClient
                .from('posts')
                .select('*')
                .gte('scheduled_at', start.toISOString())
                .lte('scheduled_at', end.toISOString())
                .order('scheduled_at', { ascending: true });

            if (filters.brandId) {
                query = query.eq('brand_id', filters.brandId);
            }
            if (filters.status) {
                if (Array.isArray(filters.status)) {
                    query = query.in('status', filters.status);
                } else {
                    query = query.eq('status', filters.status);
                }
            }
            if (filters.platformId) {
                query = query.contains('platforms', [filters.platformId]);
            }

            const { data, error } = await query;
            if (error) {
                console.error('Failed to get posts in range:', error);
                return [];
            }
            return data || [];
        } else {
            return Array.from(this.posts.values())
                .filter(p =>
                    p.scheduled_at &&
                    new Date(p.scheduled_at) >= start &&
                    new Date(p.scheduled_at) <= end &&
                    (!filters.brandId || p.brand_id === filters.brandId) &&
                    (!filters.status || (Array.isArray(filters.status) ? filters.status.includes(p.status) : p.status === filters.status))
                )
                .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
        }
    }

    /**
     * Get jobs in a date range that haven't been imported to posts yet
     * These show as "generating" or "pending" items on the calendar
     * @param {Date} start - Range start
     * @param {Date} end - Range end
     * @param {Object} filters - Optional filters { brandId }
     * @returns {Promise<Object[]>}
     */
    async getJobsInRange(start, end, filters = {}) {
        if (!this.useSupabase) return [];

        try {
            let query = supabaseClient
                .from('jobs')
                .select('id, title, status, vibe_preset, scheduled_post_at, brand_id, batch_id, created_at')
                .not('status', 'eq', 'complete')
                .not('scheduled_post_at', 'is', null)
                .gte('scheduled_post_at', start.toISOString())
                .lte('scheduled_post_at', end.toISOString())
                .order('scheduled_post_at', { ascending: true });

            if (filters.brandId) {
                query = query.eq('brand_id', filters.brandId);
            }

            const { data, error } = await query;
            if (error) {
                console.error('Failed to get jobs in range:', error);
                return [];
            }
            return data || [];
        } catch (e) {
            console.error('Error fetching jobs for calendar:', e);
            return [];
        }
    }

    /**
     * Get combined calendar items (posts + pending jobs) for a date range
     * Maps everything to a unified calendar item shape
     * @param {Date} start - Range start
     * @param {Date} end - Range end
     * @param {Object} filters - Optional filters { brandId, status, platformId }
     * @returns {Promise<Object[]>} Unified calendar items
     */
    async getCalendarItems(start, end, filters = {}) {
        // Fetch posts and pending jobs in parallel
        const [posts, jobs] = await Promise.all([
            this.getPostsInRange(start, end, filters),
            this.getJobsInRange(start, end, filters)
        ]);

        // Map posts to calendar item shape
        const postItems = posts.map(p => ({
            id: p.id,
            type: 'post',
            scheduledAt: new Date(p.scheduled_at),
            status: p.status,
            platformId: (p.platforms && p.platforms[0]) || 'youtube',
            brandId: p.brand_id,
            content: {
                title: p.title || 'Untitled',
                description: p.description || '',
                videoUrl: p.video_url,
                thumbnailUrl: p.thumbnail_url,
                duration: p.duration_seconds
            },
            publishedAt: p.posted_at ? new Date(p.posted_at) : null,
            lastError: p.error_message,
            sourceJobId: p.source_job_id,
            batchId: p.generation_batch_id,
            raw: p
        }));

        // Map pending jobs to calendar item shape
        // Filter out jobs that already have a corresponding post
        const importedJobIds = new Set(posts.filter(p => p.source_job_id).map(p => p.source_job_id));
        const pendingJobItems = jobs
            .filter(j => !importedJobIds.has(j.id))
            .map(j => ({
                id: `job-${j.id}`,
                type: 'job',
                scheduledAt: new Date(j.scheduled_post_at),
                status: j.status === 'pending' ? 'pending' : 'generating',
                platformId: 'youtube',
                brandId: j.brand_id,
                content: {
                    title: j.title || `${j.vibe_preset || 'Video'} (generating...)`,
                    description: `Job status: ${j.status}`,
                    videoUrl: null,
                    thumbnailUrl: null,
                    duration: null
                },
                publishedAt: null,
                lastError: null,
                sourceJobId: j.id,
                batchId: j.batch_id,
                raw: j
            }));

        // Combine and sort by scheduled time
        const allItems = [...postItems, ...pendingJobItems];
        allItems.sort((a, b) => a.scheduledAt - b.scheduledAt);

        return allItems;
    }

    /**
     * Get posts by status
     */
    async getPostsByStatus(status, brandId = null) {
        if (this.useSupabase) {
            let query = supabaseClient
                .from('posts')
                .select('*')
                .eq('status', status)
                .order('created_at', { ascending: false });

            if (brandId) {
                query = query.eq('brand_id', brandId);
            }

            const { data, error } = await query;
            if (error) throw error;
            return data || [];
        } else {
            return Array.from(this.posts.values())
                .filter(p => 
                    p.status === status &&
                    (!brandId || p.brand_id === brandId)
                );
        }
    }

    // ==================== Status Management ====================

    /**
     * Approve a post (move from draft to approved)
     */
    async approvePost(id) {
        return this.updatePost(id, { status: this.STATUS.APPROVED });
    }

    /**
     * Schedule a post
     * @param {string} id - Post ID
     * @param {Date|string} scheduledAt - When to post
     */
    async schedulePost(id, scheduledAt) {
        const scheduledDate = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
        
        return this.updatePost(id, {
            status: this.STATUS.SCHEDULED,
            scheduled_at: scheduledDate.toISOString()
        });
    }

    /**
     * Schedule multiple posts at optimal times
     * @param {string[]} postIds - Post IDs to schedule
     * @param {Object} options - Scheduling options
     */
    async bulkSchedule(postIds, options = {}) {
        const {
            startDate = new Date(),
            postsPerDay = 1,
            preferredHours = [17, 14, 20], // 5pm, 2pm, 8pm
            intervalMinutes = 0 // Minutes between posts on same day
        } = options;

        const results = [];
        let currentDate = new Date(startDate);
        let postsToday = 0;
        let hourIndex = 0;

        for (const postId of postIds) {
            if (postsToday >= postsPerDay) {
                // Move to next day
                currentDate.setDate(currentDate.getDate() + 1);
                postsToday = 0;
                hourIndex = 0;
            }

            // Set the scheduled time
            const scheduledAt = new Date(currentDate);
            scheduledAt.setHours(preferredHours[hourIndex % preferredHours.length], 0, 0, 0);
            
            if (intervalMinutes > 0 && postsToday > 0) {
                scheduledAt.setMinutes(intervalMinutes * postsToday);
            }

            try {
                const result = await this.schedulePost(postId, scheduledAt);
                results.push({ postId, success: true, scheduledAt: scheduledAt.toISOString() });
            } catch (e) {
                results.push({ postId, success: false, error: e.message });
            }

            postsToday++;
            hourIndex++;
        }

        return results;
    }

    /**
     * Mark a post as posting (in progress)
     */
    async markAsPosting(id) {
        return this.updatePost(id, { status: this.STATUS.POSTING });
    }

    /**
     * Mark a post as successfully posted
     * @param {string} id - Post ID
     * @param {Object} platformResults - Results from each platform
     */
    async markAsPosted(id, platformResults) {
        return this.updatePost(id, {
            status: this.STATUS.POSTED,
            posted_at: new Date().toISOString(),
            platform_results: platformResults
        });
    }

    /**
     * Mark a post as failed
     * @param {string} id - Post ID
     * @param {string} errorMessage - Error message
     */
    async markAsFailed(id, errorMessage) {
        const post = await this.getPost(id);
        return this.updatePost(id, {
            status: this.STATUS.FAILED,
            error_message: errorMessage,
            retry_count: (post?.retry_count || 0) + 1,
            last_retry_at: new Date().toISOString()
        });
    }

    /**
     * Cancel a scheduled post
     */
    async cancelPost(id) {
        return this.updatePost(id, {
            status: this.STATUS.CANCELLED,
            scheduled_at: null
        });
    }

    /**
     * Reschedule a failed post for retry
     */
    async retryPost(id, scheduledAt = null) {
        const scheduleTime = scheduledAt || new Date(Date.now() + 5 * 60 * 1000); // 5 min from now
        return this.updatePost(id, {
            status: this.STATUS.SCHEDULED,
            scheduled_at: scheduleTime instanceof Date ? scheduleTime.toISOString() : scheduleTime,
            error_message: null
        });
    }

    // ==================== Statistics ====================

    /**
     * Get queue statistics for a brand
     */
    async getStats(brandId = null) {
        const statuses = Object.values(this.STATUS);
        const stats = {};

        for (const status of statuses) {
            const posts = await this.getPostsByStatus(status, brandId);
            stats[status] = posts.length;
        }

        // Get upcoming posts for next 7 days
        const upcoming = await this.getUpcomingPosts(brandId, 7);
        stats.upcoming = upcoming.length;

        return stats;
    }

    // ==================== Local Storage ====================

    loadFromLocalStorage() {
        try {
            const data = localStorage.getItem('contentengine_posts');
            if (data) {
                const posts = JSON.parse(data);
                posts.forEach(p => this.posts.set(p.id, p));
            }
        } catch (e) {
            console.error('Error loading posts from localStorage:', e);
        }
    }

    saveToLocalStorage() {
        try {
            const posts = Array.from(this.posts.values());
            localStorage.setItem('contentengine_posts', JSON.stringify(posts));
        } catch (e) {
            console.error('Error saving posts to localStorage:', e);
        }
    }

    // ==================== Events ====================

    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
    }

    off(event, callback) {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            const index = callbacks.indexOf(callback);
            if (index > -1) callbacks.splice(index, 1);
        }
    }

    emit(event, data) {
        const callbacks = this.listeners.get(event) || [];
        callbacks.forEach(cb => cb(data));
    }
}

// Export singleton
window.postQueueService = new PostQueueService();
