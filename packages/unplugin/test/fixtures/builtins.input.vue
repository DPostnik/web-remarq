<template>
  <transition name="fade">
    <div v-if="visible">
      <slot name="content" />
      <component :is="dynamic" />
    </div>
  </transition>
</template>
