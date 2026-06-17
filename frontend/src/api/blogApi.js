import { fetchWithAuth, API_BASE } from './client.js';

export const blogApi = {
  getBlogs: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return fetchWithAuth(`/blogs${query ? `?${query}` : ''}`);
  },

  getBlog: (slug) => fetchWithAuth(`/blogs/${encodeURIComponent(slug)}`),

  createBlog: (blogData) => fetchWithAuth('/blogs', {
    method: 'POST',
    body: JSON.stringify(blogData),
  }),

  updateBlog: (id, blogData) => fetchWithAuth(`/blogs/${id}`, {
    method: 'PUT',
    body: JSON.stringify(blogData),
  }),

  publishBlog: (id) => fetchWithAuth(`/blogs/${id}/publish`, {
    method: 'POST',
  }),

  deleteBlog: (id) => fetchWithAuth(`/blogs/${id}`, {
    method: 'DELETE',
  }),
};