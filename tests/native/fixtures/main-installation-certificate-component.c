/* This target is compiled only by the private component test, never the artifact builder. */
#ifndef MI_INSTALLATION_CERT_COMPONENT_BUILD
#error COMPONENT_TARGET_ONLY
#endif
#include "../../../native/main-installation/main-installation-certifier.c"
