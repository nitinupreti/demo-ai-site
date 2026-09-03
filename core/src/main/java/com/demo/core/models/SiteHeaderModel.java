/*
 * Copyright 2026 Demo AI Site
 * Licensed under the Apache License, Version 2.0.
 */
package com.demo.core.models;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class SiteHeaderModel {

    @ValueMapValue
    private String brandLabel;

    @ValueMapValue
    private String brandHref;

    @ValueMapValue
    private String regionLabel;

    @ChildResource
    private Resource utility;

    @ChildResource
    private Resource mainNav;

    public String getBrandLabel() { return StringUtils.defaultIfBlank(brandLabel, "Credera Logo"); }

    public String getBrandHref() { return normalize(brandHref); }

    public String getRegionLabel() { return regionLabel; }

    public List<Utility> getUtilityItems() {
        if (utility == null) return Collections.emptyList();
        List<Utility> out = new ArrayList<>();
        for (Resource child : utility.getChildren()) {
            Utility item = child.adaptTo(Utility.class);
            if (item != null && item.isValid()) out.add(item);
        }
        return out;
    }

    public List<NavItem> getMainNavItems() {
        if (mainNav == null) return Collections.emptyList();
        List<NavItem> out = new ArrayList<>();
        for (Resource child : mainNav.getChildren()) {
            NavItem item = child.adaptTo(NavItem.class);
            if (item != null && item.isValid()) out.add(item);
        }
        return out;
    }

    private static String normalize(String path) {
        if (StringUtils.isBlank(path)) return null;
        if (path.startsWith("/content") && !path.contains(".")) return path + ".html";
        return path;
    }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class Utility {

        @ValueMapValue
        private String label;

        @ValueMapValue
        private String href;

        @ValueMapValue
        private String ariaLabel;

        @ValueMapValue
        private String icon;

        public String getLabel() { return label; }

        public String getHref() { return normalize(href); }

        public String getAriaLabel() { return StringUtils.defaultIfBlank(ariaLabel, label); }

        public String getIcon() { return StringUtils.lowerCase(StringUtils.defaultString(icon, "none")); }

        public boolean isValid() {
            return StringUtils.isNotBlank(label) || StringUtils.equals(getIcon(), "search");
        }
    }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class NavItem {

        @ValueMapValue
        private String label;

        @ValueMapValue
        private String href;

        public String getLabel() { return label; }

        public String getHref() { return normalize(href); }

        public boolean isValid() { return StringUtils.isNotBlank(label); }
    }
}
