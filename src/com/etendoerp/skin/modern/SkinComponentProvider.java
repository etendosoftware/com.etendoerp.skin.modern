/*
 *************************************************************************
 * Copyright (C) 2026 Futit Services S.L.
 * Licensed under the Openbravo Public License version 1.1.
 * You may obtain a copy of the License at
 * http://www.openbravo.com/legal/license.html
 ************************************************************************
 */

package com.etendoerp.skin.modern;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import javax.enterprise.context.ApplicationScoped;

import org.openbravo.client.kernel.BaseComponentProvider;
import org.openbravo.client.kernel.Component;
import org.openbravo.client.kernel.ComponentProvider;

/**
 * Registers the modern skin stylesheet and script with the kernel resource pipeline.
 * <p>
 * Resources are registered unconditionally on purpose. The generated bundles are cached globally
 * under a key built from the application name and the skin version only (see
 * {@code StyleSheetResourceComponent#getAppNameKey}), so making registration depend on a preference
 * would freeze the bundle with whatever the first requesting user happened to have configured.
 * Everything client, role or user specific is therefore decided in the browser by
 * {@code etendo-skin.js}, which reads {@code OB.Properties}.
 */
@ApplicationScoped
@ComponentProvider.Qualifier(SkinComponentProvider.COMPONENT_TYPE)
public class SkinComponentProvider extends BaseComponentProvider {

  public static final String COMPONENT_TYPE = "com.etendoerp.skin.modern_Resources";

  private static final String WEB_PATH = "web/com.etendoerp.skin.modern/";

  @Override
  public Component getComponent(String componentId, Map<String, Object> parameters) {
    throw new IllegalArgumentException("Component id " + componentId + " not supported.");
  }

  @Override
  public List<ComponentResource> getGlobalComponentResources() {
    final List<ComponentResource> globalResources = new ArrayList<ComponentResource>();

    globalResources.add(createStyleSheetResource(WEB_PATH + "css/etendo-skin.css", false));
    globalResources.add(createStaticResource(WEB_PATH + "js/etendo-skin.js", false));
    // Must come after etendo-skin.js: it stands down unless that script has published OB.ETSkin.
    globalResources.add(createStaticResource(WEB_PATH + "js/etendo-skin-nav.js", false));
    globalResources.add(createStaticResource(WEB_PATH + "js/etendo-skin-topbar.js", false));
    globalResources.add(createStaticResource(WEB_PATH + "js/etendo-skin-toolbar.js", false));
    globalResources.add(createStaticResource(WEB_PATH + "js/etendo-skin-form.js", false));
    globalResources.add(createStaticResource(WEB_PATH + "js/etendo-skin-grid.js", false));
    globalResources.add(createStaticResource(WEB_PATH + "js/etendo-skin-dashboard.js", false));

    return globalResources;
  }
}
