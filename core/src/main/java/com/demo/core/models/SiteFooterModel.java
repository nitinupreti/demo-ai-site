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
public class SiteFooterModel {

    @ValueMapValue
    private String brandLabel;

    @ValueMapValue
    private String brandHref;

    @ValueMapValue
    private String brandBlurb;

    @ValueMapValue
    private String copyright;

    @ChildResource
    private Resource columns;

    @ChildResource
    private Resource socials;

    public String getBrandLabel() {
        return StringUtils.defaultIfBlank(brandLabel, "Credera Logo");
    }

    public String getBrandHref() {
        return normalize(brandHref);
    }

    public String getBrandBlurb() {
        return brandBlurb;
    }

    public String getCopyright() {
        return copyright;
    }

    public List<Column> getColumns() {
        if (columns == null) return Collections.emptyList();
        List<Column> out = new ArrayList<>();
        for (Resource child : columns.getChildren()) {
            Column c = child.adaptTo(Column.class);
            if (c != null && c.isValid()) out.add(c);
        }
        return out;
    }

    public List<Social> getSocialLinks() {
        if (socials == null) return Collections.emptyList();
        List<Social> out = new ArrayList<>();
        for (Resource child : socials.getChildren()) {
            Social s = child.adaptTo(Social.class);
            if (s != null && s.isValid()) out.add(s);
        }
        return out;
    }

    private static String normalize(String path) {
        if (StringUtils.isBlank(path)) return null;
        if (path.startsWith("/content") && !path.contains(".")) return path + ".html";
        return path;
    }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class Column {

        @ValueMapValue
        private String heading;

        @ChildResource
        private Resource links;

        public String getHeading() { return heading; }

        public List<Link> getLinks() {
            if (links == null) return Collections.emptyList();
            List<Link> out = new ArrayList<>();
            for (Resource child : links.getChildren()) {
                Link l = child.adaptTo(Link.class);
                if (l != null && l.isValid()) out.add(l);
            }
            return out;
        }

        public boolean isValid() {
            return StringUtils.isNotBlank(heading) || !getLinks().isEmpty();
        }
    }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class Link {

        @ValueMapValue
        private String label;

        @ValueMapValue
        private String linkPath;

        public String getLabel() { return label; }

        public String getHref() { return normalize(linkPath); }

        public boolean isValid() { return StringUtils.isNotBlank(label); }
    }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class Social {

        @ValueMapValue
        private String label;

        @ValueMapValue
        private String href;

        @ValueMapValue
        private String icon;

        public String getLabel() { return label; }

        public String getHref() { return href; }

        public String getIcon() { return StringUtils.lowerCase(icon); }

        public boolean isValid() {
            return StringUtils.isNotBlank(href) && StringUtils.isNotBlank(icon);
        }
    }
}
