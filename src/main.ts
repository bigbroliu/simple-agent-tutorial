import { createApp } from 'vue';
import router from './router';
import App from './App.vue';
import './styles/global.css';
import { syncLocalFileConfigs } from './core/config';
import { useActiveModel } from './components/useActiveModel';

// 把 models.local.json(若存在)合并进 localStorage。
// 注意顺序:useActiveModel 的模块级 ref 在 import 阶段就读过一次 localStorage 了,
// 所以合并后必须 refresh 一次,顶部"当前模型"才会同步。
if (syncLocalFileConfigs()) useActiveModel().refresh();

createApp(App).use(router).mount('#app');
