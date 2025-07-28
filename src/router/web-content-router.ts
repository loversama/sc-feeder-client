import { createRouter, createWebHashHistory, RouteRecordRaw } from 'vue-router';
import ProfilePage from '../pages/ProfilePage.vue';
import LeaderboardPage from '../pages/LeaderboardPage.vue';

const routes: Array<RouteRecordRaw> = [
  {
    path: '/',
    redirect: '/profile', // Default to profile page
  },
  {
    path: '/profile',
    name: 'Profile',
    component: ProfilePage,
  },
  {
    path: '/leaderboard',
    name: 'Leaderboard',
    component: LeaderboardPage,
  },
];

const router = createRouter({
  history: createWebHashHistory(), // Use hash history for Electron file URLs
  routes,
});

export default router;