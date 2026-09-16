<template>
  <NuxtRouteAnnouncer />
  <TooltipProvider :delay-duration="500" :skip-delay-duration="300">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </TooltipProvider>
</template>
