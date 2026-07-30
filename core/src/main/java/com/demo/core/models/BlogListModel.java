/*
 *  Copyright 2025 Adobe Systems Incorporated
 */
package com.demo.core.models;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;
import javax.annotation.PostConstruct;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Default;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class BlogListModel {

    @ValueMapValue
    private String title;
    @ValueMapValue
    private String description;

    @ValueMapValue
    @Default(values = "3")
    private String columns;

    @ValueMapValue
    @Default(values = "md")
    private String sectionPadding;

    @ValueMapValue
    @Default(values = "white")
    private String backgroundColor;

    @ValueMapValue
    private String hexColor;

    @ChildResource
    private List<BlogItem> items;

    @PostConstruct
    protected void init() {
        if (items == null) {
            items = Collections.emptyList();
        } else {
            items = items.stream().filter(BlogItem::isHasContent).collect(Collectors.toList());
        }
    }

    public String getTitle() { return title; }
    public String getDescription() { return description; }
    public String getColumns() { return columns; }
    public String getSectionPadding() { return sectionPadding; }
    public String getBackgroundColor() { return backgroundColor; }

    public List<BlogItem> getItems() {
        return items == null ? Collections.emptyList() : new ArrayList<>(items);
    }

    public String getBackgroundStyle() {
        if ("other".equals(backgroundColor) && StringUtils.isNotBlank(hexColor)) {
            return "background-color: " + hexColor.trim() + ";";
        }
        return null;
    }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(title)
                || StringUtils.isNotBlank(description)
                || (items != null && !items.isEmpty());
    }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class BlogItem {
        @ValueMapValue
        private String imagePath;
        @ValueMapValue
        private String imageAlt;
        @ValueMapValue
        private String title;
        @ValueMapValue
        private String linkText;
        @ValueMapValue
        private String linkUrl;

        public String getImagePath() { return imagePath; }
        public String getImageAlt() { return StringUtils.defaultString(imageAlt); }
        public String getTitle() { return title; }
        public String getLinkText() { return linkText; }
        public String getLinkUrl() { return linkUrl; }

        public boolean isHasContent() {
            return StringUtils.isNotBlank(title);
        }
    }
}
